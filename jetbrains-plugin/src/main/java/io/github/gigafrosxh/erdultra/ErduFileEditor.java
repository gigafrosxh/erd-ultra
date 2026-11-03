package io.github.gigafrosxh.erdultra;

import com.google.gson.JsonObject;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.command.CommandProcessor;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.event.DocumentEvent;
import com.intellij.openapi.editor.event.DocumentListener;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileDocumentManagerListener;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorState;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.util.UserDataHolderBase;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.util.Alarm;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.JComponent;
import java.beans.PropertyChangeListener;
import java.io.IOException;
import java.util.Objects;

/**
 * Grafischer Editor für .erdu-Dateien. Die App arbeitet direkt auf dem IDE-Dokument der Datei:
 * Speichern, Änderungsmarkierung, lokale Historie und VCS laufen damit wie bei jeder anderen Datei.
 */
final class ErduFileEditor extends UserDataHolderBase implements FileEditor {
    private final VirtualFile file;
    private final Document document;
    private final ErduBrowserPanel panel;
    private final Alarm pushAlarm = new Alarm(Alarm.ThreadToUse.SWING_THREAD, this);
    /** Gerade von der App übernommener Text – nicht wieder zurückschicken */
    private boolean applying;
    private boolean lastModified;

    ErduFileEditor(@NotNull Project project, @NotNull VirtualFile file) {
        this.file = file;
        this.document = Objects.requireNonNull(FileDocumentManager.getInstance().getDocument(file), "Kein Dokument für " + file.getPath());
        this.panel = new ErduBrowserPanel(project, ErduBrowserPanel.Mode.EDITOR, file, this::call);
        Disposer.register(this, panel);

        document.addDocumentListener(new DocumentListener() {
            @Override
            public void documentChanged(@NotNull DocumentEvent event) {
                if (applying) return;
                // Änderung im Text-Editor, durch VCS o. Ä. → App neu laden (gebündelt)
                pushAlarm.cancelAllRequests();
                pushAlarm.addRequest(() -> {
                    panel.emit("loadDoc", document.getText());
                    pushModified();
                }, 300);
            }
        }, this);

        ApplicationManager.getApplication().getMessageBus().connect(this).subscribe(FileDocumentManagerListener.TOPIC, new FileDocumentManagerListener() {
            @Override
            public void beforeDocumentSaving(@NotNull Document doc) {
                if (doc == document) ApplicationManager.getApplication().invokeLater(ErduFileEditor.this::pushModified);
            }

            @Override
            public void fileContentReloaded(@NotNull VirtualFile f, @NotNull Document doc) {
                if (doc == document) ApplicationManager.getApplication().invokeLater(ErduFileEditor.this::pushModified);
            }
        });
    }

    private boolean isFileModified() {
        return FileDocumentManager.getInstance().isDocumentUnsaved(document);
    }

    private void pushModified() {
        boolean m = isFileModified();
        if (m == lastModified) return;
        lastModified = m;
        panel.emit("modified", m);
    }

    private @Nullable Object call(@NotNull String method, @NotNull JsonObject params) throws IOException {
        switch (method) {
            case "ready" -> {
                JsonObject r = new JsonObject();
                r.addProperty("path", file.getPath());
                r.addProperty("text", document.getText());
                lastModified = isFileModified();
                r.addProperty("modified", lastModified);
                return r;
            }
            case "docChanged" -> {
                apply(params.get("text").getAsString());
                pushModified();
                return null;
            }
            case "saveDoc" -> {
                apply(params.get("text").getAsString());
                FileDocumentManager.getInstance().saveDocument(document);
                pushModified();
                return null;
            }
            default -> {
                return ErduBrowserPanel.Handler.NOT_HANDLED;
            }
        }
    }

    private void apply(String text) throws IOException {
        if (text.equals(document.getText())) return;
        if (!document.isWritable() && !FileDocumentManager.getInstance().requestWriting(document, null)) {
            throw new IOException("Die Datei ist schreibgeschützt");
        }
        applying = true;
        try {
            // Rückgängig/Wiederholen verwaltet die App selbst
            CommandProcessor.getInstance().runUndoTransparentAction(() ->
                    ApplicationManager.getApplication().runWriteAction(() -> document.setText(text)));
        } finally {
            applying = false;
        }
    }

    @Override public @NotNull JComponent getComponent() { return panel.getComponent(); }
    @Override public @Nullable JComponent getPreferredFocusedComponent() { return panel.getComponent(); }
    @Override public @NotNull String getName() { return "ERD-Ultra"; }
    @Override public @NotNull VirtualFile getFile() { return file; }
    @Override public void setState(@NotNull FileEditorState state) {}
    @Override public boolean isModified() { return isFileModified(); }
    @Override public boolean isValid() { return file.isValid(); }
    @Override public void addPropertyChangeListener(@NotNull PropertyChangeListener listener) {}
    @Override public void removePropertyChangeListener(@NotNull PropertyChangeListener listener) {}
    @Override public void dispose() {}
}
