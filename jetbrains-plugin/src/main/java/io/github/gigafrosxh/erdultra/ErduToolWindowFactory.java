package io.github.gigafrosxh.erdultra;

import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.util.Disposer;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import com.intellij.ui.jcef.JBCefApp;
import org.jetbrains.annotations.NotNull;

import javax.swing.SwingConstants;

/** Tool-Fenster mit der kompletten ERD-Ultra-App (eigene Dateien über Öffnen/Speichern). */
public final class ErduToolWindowFactory implements ToolWindowFactory, DumbAware {
    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        ContentFactory factory = ContentFactory.getInstance();
        if (!JBCefApp.isSupported()) {
            JBLabel label = new JBLabel("ERD-Ultra benötigt JCEF – diese IDE-Laufzeit unterstützt es nicht.", SwingConstants.CENTER);
            toolWindow.getContentManager().addContent(factory.createContent(label, "", false));
            return;
        }
        ErduBrowserPanel panel = new ErduBrowserPanel(project, ErduBrowserPanel.Mode.TOOLWINDOW, null, null);
        Content content = factory.createContent(panel.getComponent(), "", false);
        content.setDisposer(panel);
        toolWindow.getContentManager().addContent(content);
    }
}
