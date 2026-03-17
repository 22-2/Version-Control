import { Plugin, WorkspaceLeaf, TFile } from 'obsidian';
import type { AppStore } from '@/state';
import { thunks } from '@/state';
import { VIEW_TYPE_VERSION_CONTROL, VIEW_TYPE_VERSION_CONTROL_NOTES } from '@/constants';
import { VersionControlView } from '@/ui/version-control-view';
import { VersionControlNotesView } from '@/ui/version-control-notes-view';
import { activateTrackedNotesView, activateVersionControlView } from '@/ui/view-activation';

/**
 * Registers the custom Version Control view using stable API.
 */
export function registerViews(plugin: Plugin, store: AppStore): void {
    plugin.registerView(
        VIEW_TYPE_VERSION_CONTROL,
        (leaf: WorkspaceLeaf) => new VersionControlView(leaf, store)
    );

    plugin.registerView(
        VIEW_TYPE_VERSION_CONTROL_NOTES,
        (leaf: WorkspaceLeaf) => new VersionControlNotesView(leaf, plugin, store)
    );
}

/**
 * Adds ribbon icon with modern click handler pattern.
 */
export function addRibbonIcon(plugin: Plugin, store: AppStore): void {
    plugin.addRibbonIcon('history', 'Open version control', (_evt: MouseEvent) => {
        void activateVersionControlView(plugin, store).catch((error) => {
            console.error('Version Control: Failed to open version control view', error);
            store.dispatch(thunks.showNotice(
                'Error: Could not open version control view. Please try again.',
                5000
            ));
        });
    });

    plugin.addRibbonIcon('files', 'Open version controlled notes', (_evt: MouseEvent) => {
        void activateTrackedNotesView(plugin).catch((error) => {
            console.error('Version Control: Failed to open version controlled notes view', error);
            store.dispatch(thunks.showNotice(
                'Error: Could not open version controlled notes view. Please try again.',
                5000
            ));
        });
    });
}

/**
 * Registers all commands with proper checkCallback patterns and typing.
 */
export function registerCommands(plugin: Plugin, store: AppStore): void {
    plugin.addCommand({
        id: 'open-version-control-view',
        name: 'Open version control view',
        callback: () => {
            void activateVersionControlView(plugin, store).catch((error) => {
                console.error('Version Control: Failed to open version control view', error);
                store.dispatch(thunks.showNotice(
                    'Error: Could not open version control view. Please try again.',
                    5000
                ));
            });
        },
    });

    plugin.addCommand({
        id: 'open-version-control-notes-view',
        name: 'Open version controlled notes view',
        callback: () => {
            void activateTrackedNotesView(plugin).catch((error) => {
                console.error('Version Control: Failed to open version controlled notes view', error);
                store.dispatch(thunks.showNotice(
                    'Error: Could not open version controlled notes view. Please try again.',
                    5000
                ));
            });
        },
    });

    plugin.addCommand({
        id: 'open-current-note-in-version-control-view',
        name: 'Open current note in version control view',
        checkCallback: (checking: boolean): boolean => {
            const activeFile = plugin.app.workspace.getActiveFile();
            if (isValidNoteFile(activeFile)) {
                if (!checking) {
                    void activateVersionControlForFile(plugin, store, activeFile);
                }
                return true;
            }
            return false;
        }
    });

    plugin.addCommand({
        id: 'save-new-version',
        name: 'Save a new version of the current note',
        checkCallback: (checking: boolean): boolean => {
            const activeFile = plugin.app.workspace.getActiveFile();
            if (isValidNoteFile(activeFile)) {
                if (!checking) {
                    store.dispatch(thunks.saveNewVersion({}));
                }
                return true;
            }
            return false;
        }
    });

    plugin.addCommand({
        id: 'save-new-edit',
        name: 'Save a new edit of the current note',
        checkCallback: (checking: boolean): boolean => {
            const activeFile = plugin.app.workspace.getActiveFile();
            if (isValidNoteFile(activeFile)) {
                if (!checking) {
                    store.dispatch(thunks.saveNewEdit());
                }
                return true;
            }
            return false;
        }
    });

    plugin.addCommand({
        id: 'cleanup-orphaned-versions',
        name: 'Clean up orphaned version data',
        callback: () => store.dispatch(thunks.cleanupOrphanedVersions()),
    });
}

/**
 * Validates note files using stable extension check.
 */
function isValidNoteFile(file: TFile | null): file is TFile {
    return Boolean(file && (file.extension === 'md' || file.extension === 'base'));
}

async function activateVersionControlForFile(
    plugin: Plugin,
    store: AppStore,
    file: TFile
): Promise<void> {
    try {
        await activateVersionControlView(plugin, store, { file });
    } catch (error) {
        console.error('Version Control: Failed to open note in version control view', error);
        store.dispatch(thunks.showNotice(
            `Error: Could not open version control for "${file.basename}".`,
            5000
        ));
    }
}
