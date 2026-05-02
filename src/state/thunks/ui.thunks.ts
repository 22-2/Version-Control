import { App, FileSystemAdapter, Menu, TFolder, TFile } from 'obsidian';
import type { AppThunk, Services } from '@/state';
import { appSlice } from '@/state';
import type { VersionHistoryEntry, ViewMode } from '@/types';
import { AppStatus, type ActionItem, type SortOrder, type SortProperty, type SortDirection } from '@/state';
import { loadEffectiveSettingsForNote } from './core.thunks';
import { shouldAbort } from '@/state/utils/guards';
import { versionActions } from '@/ui/VersionActions';
import { editActions } from '@/ui/EditActions';
import { createBranch, switchBranch, requestDeleteBranch, viewVersionInPanel } from '@/state/thunks/version';
import { historyApi } from '@/state/apis/history.api';

/**
 * Thunks related to UI interactions, such as opening panels, tabs, and modals.
 */

type ResolvedClipboardPath = { value: string; isFullPath: boolean };
type VersionMenuTrigger =
    | { mouseEvent: MouseEvent }
    | { position: { x: number; y: number } };

const isProbablyAbsolutePath = (value: string): boolean => {
    if (!value) return false;

    // file:// URLs are absolute by definition
    if (/^file:\/\//i.test(value)) return true;

    // Windows drive letter paths (C:\ or C:/)
    if (/^[a-zA-Z]:[\\/]/.test(value)) return true;

    // Windows UNC paths (\\server\share)
    if (/^\\\\/.test(value)) return true;

    // POSIX absolute paths
    return value.startsWith('/');
};

/**
 * Resolves a stored path for clipboard use.
 * - If already absolute, returns it as-is.
 * - If vault base path is available (desktop), resolves to an absolute path.
 * - Otherwise returns the original value as vault-relative.
 */
const resolvePathForClipboard = (rawPath: string, app: App): ResolvedClipboardPath | null => {
    const trimmed = (rawPath ?? '').trim();
    if (!trimmed) return null;

    if (isProbablyAbsolutePath(trimmed)) {
        return { value: trimmed, isFullPath: true };
    }

    // On Obsidian desktop, the adapter is usually FileSystemAdapter and exposes getBasePath().
    // On mobile, it may not, so we gracefully fall back to vault-relative paths.
    try {
        const adapter = app.vault.adapter;
        if (adapter instanceof FileSystemAdapter) {
            // Prefer the official API if available.
            const getFullPath = (adapter as unknown as { getFullPath?: (p: string) => string }).getFullPath;
            if (typeof getFullPath === 'function') {
                const absolute = getFullPath.call(adapter, trimmed);
                if (absolute) return { value: absolute, isFullPath: true };
            }

            const basePath = adapter.getBasePath?.();
            if (basePath && typeof basePath === 'string') {
                const sep = basePath.includes('\\') ? '\\' : '/';
                const normalizedRelative = trimmed.replace(/[\\/]/g, sep);
                const normalizedBase = basePath.endsWith('\\') || basePath.endsWith('/')
                    ? basePath.slice(0, -1)
                    : basePath;
                return { value: `${normalizedBase}${sep}${normalizedRelative}`, isFullPath: true };
            }
        }
    } catch (_error) {
        // Fall through to relative return.
    }

    return { value: trimmed, isFullPath: false };
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
    const value = (text ?? '').toString();
    if (!value) return false;

    // Preferred modern API
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch (_error) {
        // Fall back
    }

    // Fallback for environments where Clipboard API is blocked
    try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '0';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch (_error) {
        return false;
    }
};

const showVersionActionMenu = (
    version: VersionHistoryEntry,
    viewMode: ViewMode,
    services: Services,
    trigger: VersionMenuTrigger
): void => {
    const actionsList = viewMode === 'edits' ? editActions : versionActions;
    const menu = new Menu();

    // Keep secondary actions in Obsidian's menu so card mode stays visually compact.
    menu.addItem(item => {
        item
            .setTitle('Preview in panel')
            .setIcon('eye')
            .onClick(() => {
                services.store.dispatch(viewVersionInPanel(version));
            });
    });

    menu.addSeparator();

    for (const action of actionsList) {
        menu.addItem(item => {
            item
                .setTitle(action.title)
                .setIcon(action.icon)
                .onClick(() => {
                    action.actionHandler(version, services.store);
                });

            if (action.isDanger) {
                item.setWarning(true);
            }
        });
    }

    if ('mouseEvent' in trigger) {
        menu.showAtMouseEvent(trigger.mouseEvent);
        return;
    }

    menu.showAtPosition(trigger.position);
};

/**
 * Updates the plugin version in settings to the current manifest version.
 * This is called after a changelog is successfully displayed to prevent it
 * from showing again on the next startup.
 * @param services The services registry.
 */
const updateVersionInSettings = async (services: Services): Promise<void> => {
    try {
        const plugin = services.plugin;
        const currentPluginVersion = plugin.manifest.version;
        if (plugin.settings.version !== currentPluginVersion) {
            plugin.settings.version = currentPluginVersion;
            await plugin.saveSettings();
        }
    } catch (error) {
        console.error("Version Control: Failed to save updated version to settings.", error);
    }
};

let lastToggleTime = 0;

export const toggleViewMode = (): AppThunk => async (dispatch, getState, services) => {
    // Throttle rapid switching to prevent UI instability
    const now = Date.now();
    if (now - lastToggleTime < 500) return;
    lastToggleTime = now;

    if (shouldAbort(services, getState)) return;
    
    // Defensive check for settings availability
    if (!services.plugin?.settings) {
        console.warn("Version Control: Plugin settings not available in toggleViewMode");
        return;
    }
    
    const state = getState().app;
    const currentMode = state.viewMode;
    const newMode: ViewMode = currentMode === 'versions' ? 'edits' : 'versions';

    // Block access to Edit History for .base files if no versions exist
    if (state.file?.extension === 'base' && currentMode === 'versions') {
        const noteId = state.noteId;
        let versionCount = 0;
        if (noteId) {
             const historyResult = historyApi.endpoints.getVersionHistory.select(noteId)(getState());
             versionCount = historyResult.data?.length ?? 0;
        }
        
        if (versionCount === 0) {
            services.uiService.showNotice("Cannot access Edit History for base files until a version is saved.", 5000);
            return;
        }
    }
    
    // 1. Pre-emptively reset effective settings to global defaults for the new mode
    const plugin = services.plugin;
    const globalDefaults = newMode === 'versions' 
        ? plugin.settings.versionHistorySettings 
        : plugin.settings.editHistorySettings;
    
    dispatch(appSlice.actions.updateEffectiveSettings({ ...globalDefaults, isGlobal: true }));

    // 2. Update State (This clears panel, diffRequest, etc. and sets status to LOADING)
    // This also increments contextVersion, invalidating previous loads.
    dispatch(appSlice.actions.setViewMode(newMode));
    
    // Capture the new context version
    const contextVersion = getState().app.contextVersion;

    // 3. Load Data for New Mode
    const { noteId, file } = state;

    // Handle Unregistered Note Case
    if (file && !noteId) {
        // No history to load, state is already set by setViewMode
        return;
    }

    // Handle Registered Note Case
    if (noteId && file) {
        // STRICT SYNCHRONIZATION:
        // We must await settings resolution BEFORE loading history.
        await dispatch(loadEffectiveSettingsForNote(noteId));
        
        // Race Check: Ensure context matches after settings load
        if (shouldAbort(services, getState, { contextVersion })) return;

        // Data loading is handled by RTK Query hooks in the UI components.
        // We don't need to manually dispatch load actions here.

        // CRITICAL: Sync watch mode AFTER settings are loaded.
        if (!shouldAbort(services, getState, { contextVersion })) {
            services.backgroundTaskManager.syncWatchMode();
        }
    }
};

export const showChangelogPanel = (options: { forceRefresh?: boolean; isManualRequest?: boolean } = {}): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    
    const { isManualRequest = true } = options;
    const plugin = services.plugin;
    const currentState = getState().app;

    if (!isManualRequest) {
        const isViewStable = currentState.status === AppStatus.INITIALIZING || currentState.status === AppStatus.READY || currentState.status === AppStatus.PLACEHOLDER || currentState.status === AppStatus.LOADING;
        const isPanelAvailable = !currentState.panel || currentState.panel.type === 'changelog';
        if (!isViewStable || !isPanelAvailable) {
            plugin.queuedChangelogRequest = { forceRefresh: options.forceRefresh ?? false, isManualRequest: false };
            return;
        }
    }

    plugin.queuedChangelogRequest = null;

    if (isManualRequest && currentState.panel) {
        dispatch(appSlice.actions.closePanel());
    }

    dispatch(appSlice.actions.openPanel({ type: 'changelog' }));
    
    await updateVersionInSettings(services);
};

export const processQueuedChangelogRequest = (): AppThunk => (dispatch, _getState, services) => {
    if (shouldAbort(services, _getState)) return;
    const plugin = services.plugin;

    const request = plugin.queuedChangelogRequest;
    if (request) {
        plugin.queuedChangelogRequest = null; 
        dispatch(showChangelogPanel(request));
    }
};

export const createDeviation = (version: VersionHistoryEntry): AppThunk => async (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const uiService = services.uiService;
    const app = services.app;
    const initialState = getState().app;
    if (initialState.isRenaming) {
        uiService.showNotice("Cannot create deviation while database is being renamed.");
        return;
    }
    if (initialState.status !== AppStatus.READY || !initialState.noteId || initialState.noteId !== version.noteId) {
        uiService.showNotice("VC: Cannot create a deviation from this version/edit because the note context changed.");
        return;
    }
    
    const folders = app.vault.getAllFolders();
    const items: ActionItem<TFolder>[] = folders.map(folder => ({
        id: folder.path,
        data: folder,
        text: folder.isRoot() ? "/" : folder.path,
    }));

    const onChooseAction = (selectedFolder: TFolder): AppThunk => async (dispatch, getState, services) => {
        if (shouldAbort(services, getState)) return;
        const versionManager = services.versionManager;
        const editHistoryManager = services.editHistoryManager;
        
        dispatch(appSlice.actions.closePanel());

        // Race Check: Ensure context matches after panel close and before async ops
        if (shouldAbort(services, getState, { noteId: version.noteId, status: AppStatus.READY })) {
            uiService.showNotice("VC: Deviation cancelled because the note context changed during folder selection.");
            return;
        }
        
        try {
            let newFile: TFile | null = null;
            const viewMode = getState().app.viewMode;

            if (viewMode === 'versions') {
                newFile = await versionManager.createDeviation(version.noteId, version.id, selectedFolder);
            } else {
                const content = await editHistoryManager.getEditContent(version.noteId, version.id);
                if (!content) throw new Error("Could not load edit content.");
                const suffix = `(from Edit #${version.versionNumber})`;
                newFile = await versionManager.createDeviationFromContent(version.noteId, content, selectedFolder, suffix);
            }

            if (newFile) {
                uiService.showNotice(`Created new note "${newFile.basename}"...`, 5000);
                await app.workspace.getLeaf(true).openFile(newFile);
            }
        } catch (error) {
            console.error("Version Control: Error creating deviation.", error);
            uiService.showNotice("VC: Failed to create a new note from this version/edit. Check the console for details.");
        }
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: 'Create new note in...',
        items,
        onChooseAction,
        showFilter: true,
    }));
};

export const copyVersionPath = (version: VersionHistoryEntry): AppThunk => async (_dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const uiService = services.uiService;
    const app = services.app;
    const pathService = services.pathService;
    const state = getState().app;

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        uiService.showNotice("VC: Cannot copy the path right now.", 4000);
        return;
    }

    let rawVersionPath: string | null = null;
    try {
        rawVersionPath = pathService.getNoteVersionPath(version.noteId, version.id);
    } catch (error) {
        console.error('Version Control: Failed to compute version path.', error);
    }

    if (!rawVersionPath) {
        uiService.showNotice('VC: Version file path is unavailable for this entry.');
        return;
    }

    const resolvedPath = resolvePathForClipboard(rawVersionPath, app);
    if (!resolvedPath) {
        uiService.showNotice('VC: Version file path is invalid.');
        return;
    }

    try {
        const copied = await copyTextToClipboard(resolvedPath.value);
        if (copied) {
            const message = resolvedPath.isFullPath
                ? 'Version file path copied to clipboard.'
                : 'Copied vault-relative version path (full path unavailable).';
            uiService.showNotice(message, resolvedPath.isFullPath ? 2500 : 4000);
        } else {
            uiService.showNotice('VC: Failed to access the clipboard. Please copy manually.');
        }
    } catch (error) {
        console.error('Version Control: Failed to copy version path.', error);
        uiService.showNotice('VC: Failed to copy the version file path. Check the console for details.');
    }
};

export const showVersionContextMenu = (
    version: VersionHistoryEntry,
    trigger: VersionMenuTrigger
): AppThunk => (_dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;

    if (state.status !== AppStatus.READY || state.noteId !== version.noteId) {
        return;
    }

    showVersionActionMenu(version, state.viewMode, services, trigger);
};

export const showSortMenu = (): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;

    if (state.status !== AppStatus.READY) return;
    
    const sortOptions: { label: string; property: SortProperty; direction: SortDirection }[] = [
        { label: 'Version (new to old)', property: 'versionNumber', direction: 'desc' },
        { label: 'Version (old to new)', property: 'versionNumber', direction: 'asc' },
        { label: 'Timestamp (new to old)', property: 'timestamp', direction: 'desc' },
        { label: 'Timestamp (old to new)', property: 'timestamp', direction: 'asc' },
        { label: 'Name (A to Z)', property: 'name', direction: 'asc' },
        { label: 'Name (Z to A)', property: 'name', direction: 'desc' },
        { label: 'Size (largest to smallest)', property: 'size', direction: 'desc' },
        { label: 'Size (smallest to largest)', property: 'size', direction: 'asc' },
    ];

    const items: ActionItem<SortOrder>[] = sortOptions.map(opt => {
        const isSelected = state.sortOrder.property === opt.property && state.sortOrder.direction === opt.direction;
        return {
            id: `${opt.property}-${opt.direction}`,
            data: { property: opt.property, direction: opt.direction },
            text: opt.label,
            icon: 'blank',
            isSelected,
        };
    });

    const onChooseAction = (sortOrder: SortOrder): AppThunk => (dispatch) => {
        dispatch(appSlice.actions.setSortOrder(sortOrder));
        dispatch(appSlice.actions.closePanel());
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: 'Sort by',
        items,
        onChooseAction,
        showFilter: false,
    }));
};

export const showBranchSwitcher = (): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;
    if (state.status !== AppStatus.READY || !state.noteId) return;

    const { availableBranches, currentBranch } = state;

    const items: ActionItem<string>[] = availableBranches.map(branchName => ({
        id: branchName,
        data: branchName,
        text: branchName,
        isSelected: branchName === currentBranch,
    }));

    const onChooseAction = (branchName: string): AppThunk => (dispatch) => {
        dispatch(switchBranch(branchName));
    };

    const onCreateAction = (newBranchName: string): AppThunk => (dispatch) => {
        dispatch(createBranch(newBranchName));
    };

    const contextActions = (item: ActionItem<string>): ActionItem<string>[] => {
        if (item.id === '__create__') return [];
        return [
            { id: 'delete', data: 'delete', text: 'Delete Branch', icon: 'trash' }
        ];
    };

    const onContextAction = (actionId: string, branchName: string): AppThunk => (dispatch) => {
        if (actionId === 'delete') {
            dispatch(requestDeleteBranch(branchName));
        }
    };

    dispatch(appSlice.actions.openPanel({
        type: 'action',
        title: 'Switch or create branch',
        items,
        onChooseAction,
        onCreateAction,
        contextActions,
        onContextAction,
        showFilter: true,
    }));
};

export const showNotice = (message: string, duration?: number): AppThunk => (_dispatch, _getState, services) => {
    if (shouldAbort(services, _getState)) return;
    const uiService = services.uiService;
    uiService.showNotice(message, duration);
};

export const closeSettingsPanelWithNotice = (message: string, duration?: number): AppThunk => (dispatch, _getState, services) => {
    if (shouldAbort(services, _getState)) return;
    const uiService = services.uiService;
    dispatch(appSlice.actions.closePanel());
    uiService.showNotice(message, duration);
};

export const openDashboard = (): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    const state = getState().app;
    if (state.status !== AppStatus.READY) return;

    dispatch(appSlice.actions.openPanel({ type: 'dashboard' }));
};

export const openPreview = (version: VersionHistoryEntry): AppThunk => (dispatch, getState, services) => {
    if (shouldAbort(services, getState)) return;
    
    dispatch(appSlice.actions.openPanel({
        type: 'preview',
        version
    }));
};
