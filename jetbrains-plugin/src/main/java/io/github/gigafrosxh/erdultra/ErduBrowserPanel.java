package io.github.gigafrosxh.erdultra;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.ide.BrowserUtil;
import com.intellij.ide.ui.LafManagerListener;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.application.WriteAction;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.fileChooser.FileChooserFactory;
import com.intellij.openapi.fileChooser.FileSaverDescriptor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.project.ProjectUtil;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileWrapper;
import com.intellij.ui.JBColor;
import com.intellij.ui.components.Magnificator;
import com.intellij.ui.components.ZoomableViewport;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.ui.jcef.JBCefBrowserBase;
import com.intellij.ui.jcef.JBCefJSQuery;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.handler.CefRequestHandlerAdapter;
import org.cef.handler.CefResourceHandler;
import org.cef.handler.CefResourceRequestHandler;
import org.cef.handler.CefResourceRequestHandlerAdapter;
import org.cef.misc.BoolRef;
import org.cef.network.CefRequest;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import javax.swing.JPanel;
import java.awt.BorderLayout;
import java.awt.Point;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;

/**
 * Eingebettete ERD-Ultra-App (JCEF) samt Brücke zur IDE.
 * <p>
 * Die App ruft {@code window.__ERDU_IDE__.call(method, params)} auf; die Anfrage landet in {@link #onQuery},
 * das Ergebnis geht per {@code _resolve} zurück. Ereignisse an die App schickt {@link #emit}.
 */
public final class ErduBrowserPanel implements Disposable {
    static final String ORIGIN = "http://erd-ultra.localhost/";
    private static final Logger LOG = Logger.getInstance(ErduBrowserPanel.class);
    private static final Gson GSON = new Gson();

    /** Zusätzliche, modusabhängige Methoden (z. B. für den .erdu-Editor). */
    public interface Handler {
        Object NOT_HANDLED = new Object();

        /** Wird im EDT aufgerufen; Rückgabe wird als JSON an die App geschickt, {@link #NOT_HANDLED} für unbekannte Methoden. */
        @Nullable Object call(@NotNull String method, @NotNull JsonObject params) throws Exception;
    }

    public enum Mode { EDITOR, TOOLWINDOW }

    private final Project project;
    private final Mode mode;
    private final @Nullable VirtualFile contextFile;
    private final Handler handler;
    private final JBCefBrowser browser;
    private final JBCefJSQuery query;
    private final JComponent component;

    public ErduBrowserPanel(@NotNull Project project, @NotNull Mode mode, @Nullable VirtualFile contextFile, @Nullable Handler handler) {
        this.project = project;
        this.mode = mode;
        this.contextFile = contextFile;
        this.handler = handler;
        browser = JBCefBrowser.createBuilder().build();
        Disposer.register(this, browser);
        // Muss vor dem Laden der Seite existieren, damit die Query-Funktion im Renderer bereitsteht
        query = JBCefJSQuery.create((JBCefBrowserBase) browser);
        Disposer.register(browser, query);
        query.addHandler(request -> {
            onQuery(request);
            return new JBCefJSQuery.Response("");
        });

        browser.getJBCefClient().addRequestHandler(new CefRequestHandlerAdapter() {
            @Override
            public CefResourceRequestHandler getResourceRequestHandler(CefBrowser b, CefFrame frame, CefRequest request,
                                                                       boolean isNavigation, boolean isDownload,
                                                                       String requestInitiator, BoolRef disableDefaultHandling) {
                if (!request.getURL().startsWith(ORIGIN)) return null;
                return new CefResourceRequestHandlerAdapter() {
                    @Override
                    public CefResourceHandler getResourceHandler(CefBrowser b, CefFrame f, CefRequest r) {
                        return new WebappResourceHandler(ErduBrowserPanel.this::injectBridge);
                    }
                };
            }

            @Override
            public boolean onBeforeBrowse(CefBrowser b, CefFrame frame, CefRequest request, boolean userGesture, boolean isRedirect) {
                String url = request.getURL();
                if (url.startsWith(ORIGIN) || url.startsWith("devtools:") || url.startsWith("about:")) return false;
                // Externe Links im System-Browser öffnen
                BrowserUtil.browse(url);
                return true;
            }
        }, browser.getCefBrowser());

        ApplicationManager.getApplication().getMessageBus().connect(this)
                .subscribe(LafManagerListener.TOPIC, (LafManagerListener) source -> emit("theme", isDark()));

        component = new PinchZoomPanel();
        component.add(browser.getComponent(), BorderLayout.CENTER);
        browser.loadURL(ORIGIN + "index.html");
    }

    public @NotNull JComponent getComponent() { return component; }

    /**
     * Trackpad-Pinch (macOS) kommt im Offscreen-Modus von JCEF nicht im Browser an. Die IDE meldet die Geste
     * an Komponenten, die {@link ZoomableViewport} implementieren; sie wird als Zoom-Ereignis an die App gereicht.
     */
    private final class PinchZoomPanel extends JPanel implements ZoomableViewport {
        private Point origin = new Point();
        private double last;

        PinchZoomPanel() {
            super(new BorderLayout());
        }

        @Override public @Nullable Magnificator getMagnificator() { return (scale, at) -> at; }

        @Override
        public void magnificationStarted(Point at) {
            origin = at != null ? at : new Point(getWidth() / 2, getHeight() / 2);
            last = 0;
        }

        @Override
        public void magnify(double magnification) {
            double factor = Math.exp(magnification - last);
            last = magnification;
            JsonObject p = new JsonObject();
            p.addProperty("factor", factor);
            p.addProperty("x", origin.x);
            p.addProperty("y", origin.y);
            emit("pinch", p);
        }

        @Override public void magnificationFinished(double magnification) { last = 0; }
    }

    private static boolean isDark() { return !JBColor.isBright(); }

    /** Bindet die Brücke vor dem App-Skript in index.html ein. */
    private String injectBridge(String html) {
        String send = query.inject("req");
        String js = """
                (function () {
                  var pending = {}, listeners = {}, seq = 0;
                  function send(req, attempt) {
                    try { %s }
                    catch (e) { if (attempt < 100) setTimeout(function () { send(req, attempt + 1); }, 50); else console.error(e); }
                  }
                  window.__ERDU_IDE__ = {
                    mode: %s,
                    dark: %s,
                    call: function (method, params) {
                      return new Promise(function (resolve, reject) {
                        var id = ++seq;
                        pending[id] = { resolve: resolve, reject: reject };
                        send(JSON.stringify({ id: id, method: method, params: params == null ? {} : params }), 0);
                      });
                    },
                    on: function (event, fn) {
                      (listeners[event] = listeners[event] || []).push(fn);
                      return function () { listeners[event] = (listeners[event] || []).filter(function (f) { return f !== fn; }); };
                    },
                    _resolve: function (id, ok, payload) {
                      var p = pending[id];
                      if (!p) return;
                      delete pending[id];
                      if (ok) p.resolve(payload); else p.reject(new Error(payload));
                    },
                    _emit: function (event, payload) {
                      (listeners[event] || []).slice().forEach(function (fn) { fn(payload); });
                    }
                  };
                })();
                """.formatted(send, GSON.toJson(mode.name().toLowerCase(Locale.ROOT)), isDark());
        return html.replaceFirst("<head>", Matcher.quoteReplacement("<head><script>" + js + "</script>"));
    }

    /** Schickt ein Ereignis an die App. */
    public void emit(@NotNull String event, @Nullable Object payload) {
        execute("window.__ERDU_IDE__ && window.__ERDU_IDE__._emit(" + GSON.toJson(event) + "," + GSON.toJson(payload) + ")");
    }

    private void execute(String js) {
        CefBrowser cef = browser.getCefBrowser();
        cef.executeJavaScript(js, cef.getURL(), 0);
    }

    private void onQuery(String request) {
        int id;
        String method;
        JsonObject params;
        try {
            JsonObject req = JsonParser.parseString(request).getAsJsonObject();
            id = req.get("id").getAsInt();
            method = req.get("method").getAsString();
            JsonElement p = req.get("params");
            params = p != null && p.isJsonObject() ? p.getAsJsonObject() : new JsonObject();
        } catch (RuntimeException e) {
            LOG.warn("Ungültige Anfrage der ERD-Ultra-App: " + request, e);
            return;
        }
        ApplicationManager.getApplication().invokeLater(() -> {
            if (project.isDisposed()) return;
            try {
                Object result = handler != null ? handler.call(method, params) : Handler.NOT_HANDLED;
                if (result == Handler.NOT_HANDLED) result = callCommon(method, params);
                resolve(id, true, result);
            } catch (Exception e) {
                LOG.info("ERD-Ultra: " + method + " fehlgeschlagen", e);
                resolve(id, false, e.getMessage() != null ? e.getMessage() : e.toString());
            }
        }, ModalityState.nonModal(), project.getDisposed());
    }

    private void resolve(int id, boolean ok, @Nullable Object payload) {
        execute("window.__ERDU_IDE__._resolve(" + id + "," + ok + "," + GSON.toJson(payload) + ")");
    }

    // ---- Dateizugriff, gemeinsam für Editor und Tool-Fenster

    private @Nullable Object callCommon(String method, JsonObject params) throws IOException {
        return switch (method) {
            case "openFile" -> openFile(params);
            case "saveFileAs" -> saveFileAs(params);
            case "readFile" -> readFile(Path.of(params.get("path").getAsString()));
            case "writeFile" -> {
                writeFile(Path.of(params.get("path").getAsString()), content(params));
                yield null;
            }
            case "openInEditor" -> {
                VirtualFile vf = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(Path.of(params.get("path").getAsString()));
                if (vf == null) throw new IOException("Datei nicht gefunden");
                FileEditorManager.getInstance(project).openFile(vf, true);
                yield null;
            }
            case "ready" -> null;
            default -> throw new IllegalArgumentException("Unbekannte Methode: " + method);
        };
    }

    private static List<String> extensions(JsonObject params) {
        List<String> exts = new ArrayList<>();
        JsonElement filters = params.get("filters");
        if (filters != null && filters.isJsonArray()) {
            for (JsonElement f : filters.getAsJsonArray()) {
                JsonArray list = f.getAsJsonObject().getAsJsonArray("extensions");
                if (list != null) list.forEach(e -> exts.add(e.getAsString().toLowerCase(Locale.ROOT)));
            }
        }
        return exts;
    }

    private @Nullable VirtualFile baseDir() {
        if (contextFile != null && contextFile.getParent() != null) return contextFile.getParent();
        return ProjectUtil.guessProjectDir(project);
    }

    private @Nullable JsonObject openFile(JsonObject params) throws IOException {
        List<String> exts = extensions(params);
        FileChooserDescriptor descriptor = new FileChooserDescriptor(true, false, false, false, false, false)
                .withTitle("Öffnen")
                .withFileFilter(f -> exts.isEmpty() || (f.getExtension() != null && exts.contains(f.getExtension().toLowerCase(Locale.ROOT))));
        VirtualFile vf = FileChooser.chooseFile(descriptor, project, baseDir());
        if (vf == null) return null;
        JsonObject result = new JsonObject();
        result.addProperty("path", vf.toNioPath().toString());
        result.addProperty("text", new String(vf.contentsToByteArray(), StandardCharsets.UTF_8));
        return result;
    }

    private @Nullable String saveFileAs(JsonObject params) throws IOException {
        String defaultName = params.has("defaultName") ? params.get("defaultName").getAsString() : null;
        FileSaverDescriptor descriptor = new FileSaverDescriptor("Speichern unter", "", extensions(params).toArray(String[]::new));
        VirtualFileWrapper target = FileChooserFactory.getInstance().createSaveFileDialog(descriptor, project).save(baseDir(), defaultName);
        if (target == null) return null;
        Path path = target.getFile().toPath();
        writeFile(path, content(params));
        return path.toString();
    }

    private static byte[] content(JsonObject params) {
        if (params.has("base64")) return Base64.getDecoder().decode(params.get("base64").getAsString());
        return params.get("text").getAsString().getBytes(StandardCharsets.UTF_8);
    }

    private static String readFile(Path path) throws IOException {
        VirtualFile vf = LocalFileSystem.getInstance().findFileByNioFile(path);
        if (vf != null) return new String(vf.contentsToByteArray(), StandardCharsets.UTF_8);
        return Files.readString(path);
    }

    /** Schreibt über das VFS, damit offene Editoren und die Projektansicht die Änderung sofort sehen. */
    private void writeFile(Path path, byte[] bytes) throws IOException {
        Files.createDirectories(path.toAbsolutePath().getParent());
        if (!Files.exists(path)) Files.write(path, new byte[0]);
        VirtualFile vf = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path);
        if (vf == null) {
            Files.write(path, bytes);
            return;
        }
        WriteAction.run(() -> vf.setBinaryContent(bytes, -1, System.currentTimeMillis(), this));
    }

    @Override
    public void dispose() {}
}
