package io.github.gigafrosxh.erdultra;

import com.intellij.ide.actions.CreateFileFromTemplateAction;
import com.intellij.ide.actions.CreateFileFromTemplateDialog;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.psi.PsiDirectory;
import org.jetbrains.annotations.NotNull;

/** Datei → Neu → ERD-Ultra-Diagramm */
public final class NewErduFileAction extends CreateFileFromTemplateAction implements DumbAware {
    @Override
    protected void buildDialog(@NotNull Project project, @NotNull PsiDirectory directory, CreateFileFromTemplateDialog.@NotNull Builder builder) {
        builder.setTitle("Neues ERD-Ultra-Diagramm")
                .addKind("ERD-Ultra-Diagramm", ErduIcons.FILE, "ERD-Ultra");
    }

    @Override
    protected @NotNull String getActionName(PsiDirectory directory, @NotNull String newName, String templateName) {
        return "ERD-Ultra-Diagramm " + newName + " anlegen";
    }
}
