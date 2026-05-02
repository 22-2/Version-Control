import { ItemView, Notice, Plugin, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { VIEW_TYPE_VERSION_CONTROL_NOTES } from '@/constants';
import type { AppStore } from '@/state';
import type { NoteEntry } from '@/types';
import { activateVersionControlView } from './view-activation';

interface TrackedNoteItem {
    noteId: string;
    entry: NoteEntry;
    file: TFile | null;
}

export class VersionControlNotesView extends ItemView {
    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: Plugin,
        private readonly store: AppStore
    ) {
        super(leaf);
        this.icon = 'files';
    }

    override getViewType(): string {
        return VIEW_TYPE_VERSION_CONTROL_NOTES;
    }

    override getDisplayText(): string {
        return 'Version controlled notes';
    }

    override async onOpen(): Promise<void> {
        this.contentEl.empty();
        this.contentEl.addClass('version-control-notes-view');

        this.registerEvent(this.app.vault.on('rename', () => void this.render()));
        this.registerEvent(this.app.vault.on('delete', () => void this.render()));
        this.registerEvent(this.app.vault.on('create', () => void this.render()));
        this.registerEvent(this.app.workspace.on('file-open', () => void this.render()));

        await this.render();
    }

    override async onClose(): Promise<void> {
        this.contentEl.empty();
    }

    private async render(): Promise<void> {
        this.contentEl.empty();

        const wrapper = this.contentEl.createDiv({ cls: 'v-notes-view' });
        const header = wrapper.createDiv({ cls: 'v-notes-view-header' });
        const titleGroup = header.createDiv({ cls: 'v-notes-view-title-group' });
        titleGroup.createEl('h3', { text: 'Version controlled notes' });
        const countEl = titleGroup.createDiv({ cls: 'v-notes-view-count', text: 'Loading...' });

        const refreshButton = header.createEl('button', {
            cls: 'clickable-icon',
            attr: { 'aria-label': 'Refresh notes' },
        });
        refreshButton.type = 'button';
        setIcon(refreshButton, 'refresh-cw');
        refreshButton.addEventListener('click', () => void this.render());

        const listEl = wrapper.createDiv({ cls: 'v-notes-list' });

        try {
            const items = await this.loadTrackedNotes();
            countEl.setText(`${items.length} ${items.length === 1 ? 'note' : 'notes'}`);

            if (items.length === 0) {
                const emptyState = listEl.createDiv({ cls: 'v-empty-state' });
                emptyState.createDiv({ cls: 'v-empty-state-icon', text: '📝' });
                emptyState.createEl('h3', { text: 'No tracked notes' });
                emptyState.createEl('p', { text: 'Start tracking notes from the Version Control panel.' });
                return;
            }

            for (const item of items) {
                this.renderListItem(listEl, item);
            }
        } catch (error) {
            console.error('Version Control: Failed to render tracked notes view', error);
            countEl.setText('Unavailable');
            const errorState = listEl.createDiv({ cls: 'v-empty-state v-error-display' });
            errorState.createDiv({ cls: 'v-empty-state-icon', text: '⚠️' });
            errorState.createEl('h3', { text: 'Failed to load notes' });
            errorState.createEl('p', { text: 'Could not load version controlled notes. Check the console for details.' });
        }
    }

    private async loadTrackedNotes(): Promise<TrackedNoteItem[]> {
        const manifestManager = (this.plugin as any).services?.manifestManager;
        if (!manifestManager) {
            return [];
        }

        const centralManifest = await manifestManager.loadCentralManifest(true);
        const noteEntries = Object.entries(centralManifest.notes as Record<string, NoteEntry>);
        const items = noteEntries
            .map(([noteId, entry]) => ({
                noteId,
                entry,
                file: this.resolveTrackedFile(entry.notePath),
            }))
            .sort((a, b) => {
                const timeA = Date.parse(a.entry.lastModified || a.entry.createdAt || '');
                const timeB = Date.parse(b.entry.lastModified || b.entry.createdAt || '');
                return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA);
            });

        return items;
    }

    private resolveTrackedFile(path: string): TFile | null {
        const abstractFile = this.app.vault.getAbstractFileByPath(path);
        return abstractFile instanceof TFile ? abstractFile : null;
    }

    private renderListItem(container: HTMLElement, item: TrackedNoteItem): void {
        const activePath = this.app.workspace.getActiveFile()?.path;
        const noteEl = container.createDiv({ cls: 'v-notes-item' });

        if (item.file?.path === activePath) {
            noteEl.addClass('is-active');
        }

        if (!item.file) {
            noteEl.addClass('is-missing');
        }

        // Use div instead of button for card-like interaction (v-history-entry style)
        if (item.file) {
            noteEl.style.cursor = 'pointer';
        }

        const basename = item.file?.basename || this.basenameFromPath(item.entry.notePath);
        
        const titleEl = noteEl.createDiv({ cls: 'v-notes-item-title' });
        titleEl.createEl('span', { text: basename });
        
        // Add status badge for missing files
        if (!item.file) {
            const badgeEl = titleEl.createEl('span', { 
                cls: 'v-notes-item-badge',
                text: 'Missing'
            });
            badgeEl.style.marginLeft = '8px';
            badgeEl.style.fontSize = 'var(--font-ui-smaller)';
            badgeEl.style.opacity = '0.7';
        }

        noteEl.createDiv({ cls: 'v-notes-item-path', text: item.entry.notePath });

        const metaEl = noteEl.createDiv({ cls: 'v-notes-item-meta' });
        const lastModified = item.entry.lastModified || item.entry.createdAt;
        if (lastModified) {
            const date = new Date(lastModified);
            metaEl.setText(`Modified: ${date.toLocaleDateString()}`);
        } else {
            metaEl.setText('No version history');
        }

        noteEl.addEventListener('click', () => {
            if (!item.file) {
                return;
            }
            void activateVersionControlView(this.plugin, this.store, {
                file: item.file,
                sourceLeaf: this.leaf,
            }).catch((error) => {
                console.error('Version Control: Failed to open tracked note in version control view', error);
                new Notice(`Could not open version control for "${item.file?.basename ?? item.entry.notePath}".`, 5000);
            });
        });
    }

    private basenameFromPath(path: string): string {
        const normalized = path.replace(/\\/g, '/');
        const segments = normalized.split('/');
        return segments[segments.length - 1] || path;
    }
}
