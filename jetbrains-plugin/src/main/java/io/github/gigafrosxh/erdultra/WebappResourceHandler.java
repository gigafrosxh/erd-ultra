package io.github.gigafrosxh.erdultra;

import org.cef.callback.CefCallback;
import org.cef.handler.CefResourceHandlerAdapter;
import org.cef.misc.IntRef;
import org.cef.misc.StringRef;
import org.cef.network.CefRequest;
import org.cef.network.CefResponse;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.function.UnaryOperator;

/**
 * Liefert die gebaute React-App aus den Plugin-Ressourcen (/webapp) unter {@link ErduBrowserPanel#ORIGIN} aus.
 * index.html wird vorher durch {@code transformIndex} geschickt, um die IDE-Brücke einzubinden.
 * <p>
 * Erbt vom Adapter: Neuere JCEF-Versionen (ab 2026.x) haben zusätzlich open/read/skip, die der Adapter
 * auf die hier implementierten klassischen Methoden zurückführt.
 */
final class WebappResourceHandler extends CefResourceHandlerAdapter {
    private static final Map<String, String> MIME = Map.ofEntries(
            Map.entry("html", "text/html"),
            Map.entry("js", "text/javascript"),
            Map.entry("mjs", "text/javascript"),
            Map.entry("css", "text/css"),
            Map.entry("svg", "image/svg+xml"),
            Map.entry("png", "image/png"),
            Map.entry("ico", "image/x-icon"),
            Map.entry("json", "application/json"),
            Map.entry("woff", "font/woff"),
            Map.entry("woff2", "font/woff2"),
            Map.entry("ttf", "font/ttf"),
            Map.entry("wasm", "application/wasm"));

    private final UnaryOperator<String> transformIndex;
    private byte[] data;
    private String mime = "text/plain";
    private int status = 200;
    private int offset;

    WebappResourceHandler(UnaryOperator<String> transformIndex) {
        this.transformIndex = transformIndex;
    }

    @Override
    public boolean processRequest(CefRequest request, CefCallback callback) {
        String path = URI.create(request.getURL()).getPath();
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        if (path.contains("..")) path = "/index.html";
        try (InputStream in = WebappResourceHandler.class.getResourceAsStream("/webapp" + path)) {
            if (in == null) {
                status = 404;
                data = ("Nicht gefunden: " + path).getBytes(StandardCharsets.UTF_8);
            } else {
                data = in.readAllBytes();
                String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
                mime = MIME.getOrDefault(ext, "application/octet-stream");
                if (path.equals("/index.html")) {
                    data = transformIndex.apply(new String(data, StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
                }
            }
        } catch (IOException e) {
            status = 500;
            data = String.valueOf(e).getBytes(StandardCharsets.UTF_8);
        }
        callback.Continue();
        return true;
    }

    @Override
    public void getResponseHeaders(CefResponse response, IntRef responseLength, StringRef redirectUrl) {
        response.setStatus(status);
        response.setMimeType(mime);
        response.setHeaderByName("Cache-Control", "no-cache", true);
        responseLength.set(data.length);
    }

    @Override
    public boolean readResponse(byte[] dataOut, int bytesToRead, IntRef bytesRead, CefCallback callback) {
        int n = Math.min(bytesToRead, data.length - offset);
        if (n <= 0) {
            bytesRead.set(0);
            return false;
        }
        System.arraycopy(data, offset, dataOut, 0, n);
        offset += n;
        bytesRead.set(n);
        return true;
    }

    @Override
    public void cancel() {}
}
