package io.github.gigafrosxh.erdultra;

import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorPolicy;
import com.intellij.openapi.fileEditor.FileEditorProvider;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.jcef.JBCefApp;
import org.jetbrains.annotations.NotNull;

/** Öffnet .erdu-Dateien grafisch; der Text-Editor bleibt als zweiter Reiter verfügbar. */
public final class ErduFileEditorProvider implements FileEditorProvider, DumbAware {
    @Override
    public boolean accept(@NotNull Project project, @NotNull VirtualFile file) {
        return ErduFileType.isErdu(file) && file.isInLocalFileSystem() && JBCefApp.isSupported();
    }

    @Override
    public @NotNull FileEditor createEditor(@NotNull Project project, @NotNull VirtualFile file) {
        return new ErduFileEditor(project, file);
    }

    @Override public @NotNull String getEditorTypeId() { return "erd-ultra-editor"; }
    @Override public @NotNull FileEditorPolicy getPolicy() { return FileEditorPolicy.PLACE_BEFORE_DEFAULT_EDITOR; }
}
