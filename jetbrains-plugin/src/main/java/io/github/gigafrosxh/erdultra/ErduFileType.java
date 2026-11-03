package io.github.gigafrosxh.erdultra;

import com.intellij.openapi.fileTypes.FileType;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import javax.swing.Icon;
import java.nio.charset.StandardCharsets;

/** ERD-Ultra-Projektdatei (.erdu, JSON). */
public final class ErduFileType implements FileType {
    public static final ErduFileType INSTANCE = new ErduFileType();
    public static final String EXTENSION = "erdu";

    private ErduFileType() {}

    @Override public @NotNull String getName() { return "ERD-Ultra"; }
    @Override public @NotNull String getDescription() { return "ERD-Ultra-Diagramm"; }
    @Override public @NotNull String getDefaultExtension() { return EXTENSION; }
    @Override public @Nullable Icon getIcon() { return ErduIcons.FILE; }
    @Override public boolean isBinary() { return false; }

    @Override
    public @NotNull String getCharset(@NotNull VirtualFile file, byte @NotNull [] content) {
        return StandardCharsets.UTF_8.name();
    }

    public static boolean isErdu(@NotNull VirtualFile file) {
        return EXTENSION.equalsIgnoreCase(file.getExtension());
    }
}
