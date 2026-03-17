import { FileView, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_VERSION_CONTROL, VIEW_TYPE_VERSION_CONTROL_NOTES } from '@/constants';
import type { AppStore } from '@/state';
import { thunks } from '@/state';

interface VersionControlActivationOptions {
    file?: TFile;
    sourceLeaf?: WorkspaceLeaf | null;
}

export async function activateVersionControlView(
    plugin: Plugin,
    store: AppStore,
    options: VersionControlActivationOptions = {}
): Promise<void> {
    const workspace = plugin.app.workspace as any;
    const targetDocument = getTargetDocument(workspace, options.sourceLeaf);
    const contextLeaf = options.file
        ? await ensureFileContextLeaf(workspace, options.file, targetDocument)
        : getContextLeaf(workspace);

    plugin.app.workspace.onLayoutReady(() => {
        store.dispatch(thunks.initializeView(contextLeaf || undefined));
    });

    const viewLeaf = await revealOrCreateViewLeaf(workspace, VIEW_TYPE_VERSION_CONTROL, targetDocument);
    if (!viewLeaf) {
        throw new Error('Failed to create version control view leaf');
    }
}

export async function activateTrackedNotesView(
    plugin: Plugin,
    sourceLeaf?: WorkspaceLeaf | null
): Promise<void> {
    const workspace = plugin.app.workspace as any;
    const targetDocument = getTargetDocument(workspace, sourceLeaf);
    const viewLeaf = await revealOrCreateViewLeaf(workspace, VIEW_TYPE_VERSION_CONTROL_NOTES, targetDocument);
    if (!viewLeaf) {
        throw new Error('Failed to create version controlled notes view leaf');
    }
}

function getContextLeaf(workspace: any): WorkspaceLeaf | null {
    const recentLeaf = workspace.getMostRecentLeaf?.();
    if (recentLeaf?.view instanceof FileView) {
        return recentLeaf;
    }

    const activeView = workspace.getActiveViewOfType?.(FileView);
    return activeView?.leaf ?? null;
}

function getTargetDocument(workspace: any, sourceLeaf?: WorkspaceLeaf | null): Document {
    const sourceDocument = sourceLeaf?.view?.containerEl?.ownerDocument;
    if (sourceDocument) {
        return sourceDocument;
    }

    const activeLeaf = workspace.getLeaf(false);
    return activeLeaf?.view?.containerEl?.ownerDocument ?? document;
}

async function revealOrCreateViewLeaf(
    workspace: any,
    viewType: string,
    targetDocument: Document
): Promise<WorkspaceLeaf | null> {
    const existingLeaves = workspace.getLeavesOfType(viewType) as WorkspaceLeaf[];
    const leafInTargetWindow = existingLeaves.find(
        (leaf) => leaf.view?.containerEl?.ownerDocument === targetDocument
    );

    if (leafInTargetWindow) {
        await workspace.revealLeaf(leafInTargetWindow);
        return leafInTargetWindow;
    }

    const newLeaf = await createTargetLeaf(workspace, targetDocument);
    if (!newLeaf) {
        return null;
    }

    await newLeaf.setViewState({ type: viewType, active: true });
    await workspace.revealLeaf(newLeaf);
    return newLeaf;
}

async function ensureFileContextLeaf(
    workspace: any,
    file: TFile,
    targetDocument: Document
): Promise<WorkspaceLeaf | null> {
    const existingLeaf = findLeafForFile(workspace, file, targetDocument);
    if (existingLeaf) {
        return existingLeaf;
    }

    const noteLeaf = await createFileLeaf(workspace, targetDocument);
    if (!noteLeaf) {
        return null;
    }

    await noteLeaf.openFile(file, { active: false });
    return noteLeaf;
}

function findLeafForFile(workspace: any, file: TFile, targetDocument: Document): WorkspaceLeaf | null {
    const allLeaves = workspace.getLeavesOfType('markdown') as WorkspaceLeaf[];
    return allLeaves.find((leaf) => {
        const fileView = leaf.view;
        return fileView instanceof FileView
            && fileView.file?.path === file.path
            && fileView.containerEl?.ownerDocument === targetDocument;
    }) ?? null;
}

async function createFileLeaf(workspace: any, targetDocument: Document): Promise<WorkspaceLeaf | null> {
    if (targetDocument === document) {
        return workspace.getLeaf(true);
    }

    return workspace.getLeaf('tab');
}

async function createTargetLeaf(workspace: any, targetDocument: Document): Promise<WorkspaceLeaf | null> {
    if (targetDocument === document) {
        const rightLeaf = workspace.getRightLeaf(false);
        if (rightLeaf) {
            return rightLeaf;
        }
    } else {
        const splitLeaf = workspace.getLeaf('split', 'vertical');
        if (splitLeaf) {
            return splitLeaf;
        }
    }

    return workspace.getLeaf(true);
}
