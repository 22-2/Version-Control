import { createAsyncThunk } from '@reduxjs/toolkit';
import { TFile } from 'obsidian';
import { appSlice, AppStatus } from '@/state';
import type { VersionHistoryEntry } from '@/types';
import type { AppThunk, ThunkConfig } from '@/state/store';
import { historyApi } from '@/state/apis/history.api';
import { shouldAbort } from '@/state/utils/guards';
import { validateNotRenaming, validateNoteContext } from '@/state/utils/thunk-validation';
import { calculateTextStats } from '@/utils/text-stats';
import { handleVersionErrorWithMessage } from '../helpers';

/**
 * Prompts the user to confirm replacing a version's content with current note content.
 */
export const requestReplaceVersionWithCurrentNoteContent = (version: VersionHistoryEntry): AppThunk => (
    dispatch,
    getState,
    services
) => {
    if (shouldAbort(services, getState)) return;

    const state = getState().app;
    if (state.status !== AppStatus.READY) return;

    const file = state.file;
    if (!file) return;

    const versionLabel = version.name
        ? `"${version.name}" (V${version.versionNumber})`
        : `Version ${version.versionNumber}`;

    dispatch(
        appSlice.actions.openPanel({
            type: 'confirmation',
            title: 'Confirm replace',
            message: `This will overwrite ${versionLabel} with the current content of "${file.basename}". This cannot be undone. Are you sure?`,
            onConfirmAction: replaceVersionWithCurrentNoteContent(version.id),
        })
    );
};

/**
 * Replaces a version's stored content with the current note content.
 */
export const replaceVersionWithCurrentNoteContent = createAsyncThunk<
    void,
    string,
    ThunkConfig
>(
    'version/replaceVersionWithCurrentNoteContent',
    async (versionId, { dispatch, getState, extra: services, rejectWithValue }) => {
        if (shouldAbort(services, getState)) return rejectWithValue('Aborted');

        const uiService = services.uiService;
        const initialState = getState().app;

        if (!validateNotRenaming(initialState.isRenaming, uiService, 'replace version content')) {
            return rejectWithValue('Renaming in progress');
        }

        if (initialState.status !== AppStatus.READY) return rejectWithValue('Not ready');

        const initialFileFromState = initialState.file;
        const initialNoteIdFromState = initialState.noteId;
        if (!validateNoteContext(initialNoteIdFromState, initialFileFromState)) {
            return rejectWithValue('Invalid context');
        }

        const file = initialFileFromState!;
        const noteId = initialNoteIdFromState!;

        dispatch(appSlice.actions.closePanel());

        try {
            const liveFile = services.app.vault.getAbstractFileByPath(file.path);
            if (!(liveFile instanceof TFile)) {
                throw new Error(
                    `Replace failed. Note "${file.basename}" may have been deleted or moved.`
                );
            }

            const currentNoteIdOnDisk = await services.noteManager.getNoteId(liveFile);
            if (currentNoteIdOnDisk !== noteId) {
                throw new Error(
                    `Replace failed. Note's version control ID has changed or was removed. Expected "${noteId}", found "${currentNoteIdOnDisk}".`
                );
            }

            const currentContent = await services.app.vault.read(liveFile);
            const textStats = calculateTextStats(currentContent);
            const timestamp = new Date().toISOString();

            const { size } = await services.versionContentRepo.write(noteId, versionId, currentContent);

            await services.manifestManager.updateNoteManifest(noteId, (manifest) => {
                const branch = manifest.branches[manifest.currentBranch];
                if (!branch) {
                    throw new Error(`Current branch not found for note ${noteId}.`);
                }

                const versionData = branch.versions[versionId];
                if (!versionData) {
                    throw new Error(`Version ${versionId} not found in manifest for note ${noteId}.`);
                }

                // Intentional: keep metadata in sync with replaced content so list/timeline stay consistent.
                versionData.timestamp = timestamp;
                versionData.size = size;
                versionData.wordCount = textStats.wordCount;
                versionData.wordCountWithMd = textStats.wordCountWithMd;
                versionData.charCount = textStats.charCount;
                versionData.charCountWithMd = textStats.charCountWithMd;
                versionData.lineCount = textStats.lineCount;
                versionData.lineCountWithoutMd = textStats.lineCountWithoutMd;
                manifest.lastModified = timestamp;
            });

            if (shouldAbort(services, getState, { noteId, filePath: file.path })) {
                uiService.showNotice(`Version replaced for "${file.basename}" in the background.`, 4000);
                dispatch(historyApi.util.invalidateTags([
                    { type: 'VersionHistory', id: noteId },
                    { type: 'Timeline', id: noteId },
                ]));
                return rejectWithValue('Context changed');
            }

            dispatch(historyApi.util.invalidateTags([
                { type: 'VersionHistory', id: noteId },
                { type: 'Timeline', id: noteId },
            ]));

            uiService.showNotice(`Version ${versionId.substring(0, 6)}... replaced with current note content.`);
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
            handleVersionErrorWithMessage(
                error,
                'replaceVersionWithCurrentNoteContent',
                `Replace failed: ${message}`,
                uiService,
                7000
            );
            return rejectWithValue(message);
        }
    }
);
