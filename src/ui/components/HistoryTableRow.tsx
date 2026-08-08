import clsx from 'clsx';
import { createContext, memo, type FC, type RefObject, useContext, useId, useMemo, useRef } from 'react';
import { flexRender, type Row } from '@tanstack/react-table';
import type { VersionHistoryEntry, ViewMode } from '@/types';
import { useAppSelector } from '@/ui/hooks';
import { HighlightedText } from '@/ui/components/shared/HighlightedText';
import { Icon } from '@/ui/components/Icon';
import { EntryEditor } from '@/ui/components/HistoryEntry/components';
import { useEntryActions, useEntryEdit, useEntryHighlight } from '@/ui/components/HistoryEntry/hooks';
import { MAX_NAME_LENGTH } from '@/ui/components/HistoryEntry/types';

interface HistoryTableRowContextValue {
    version: VersionHistoryEntry;
    hasDescription: boolean;
    isDescriptionExpanded: boolean;
    descriptionId: string;
    showNameEditor: boolean;
    isEditing: boolean;
    searchQuery: string;
    isSearchCaseSensitive: boolean;
    nameValue: string;
    setNameValue: (value: string) => void;
    nameInputRef: RefObject<HTMLInputElement | null>;
    handleNameInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    toggleDescription: () => void;
}

const HistoryTableRowContext = createContext<HistoryTableRowContextValue | null>(null);

function useHistoryTableRow(): HistoryTableRowContextValue {
    const value = useContext(HistoryTableRowContext);
    if (!value) throw new Error('History table cells must be rendered inside HistoryTableRow.');
    return value;
}

export const HistoryDescriptionToggleCell: FC = () => {
    const {
        hasDescription,
        isDescriptionExpanded,
        descriptionId,
        toggleDescription,
        isEditing,
    } = useHistoryTableRow();

    if (!hasDescription || isEditing) return null;

    const label = `${isDescriptionExpanded ? 'Collapse' : 'Expand'} description`;
    return (
        <span
            className="v-history-table-expander clickable-icon"
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-expanded={isDescriptionExpanded}
            aria-controls={descriptionId}
            title={label}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleDescription();
            }}
            onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleDescription();
                }
            }}
        >
            <Icon name={isDescriptionExpanded ? 'chevron-up' : 'chevron-down'} />
        </span>
    );
};

export const HistoryNameCell: FC<{ emptyLabel?: string }> = ({ emptyLabel = 'Untitled' }) => {
    const {
        version,
        showNameEditor,
        nameValue,
        setNameValue,
        nameInputRef,
        handleNameInputKeyDown,
        searchQuery,
        isSearchCaseSensitive,
    } = useHistoryTableRow();

    if (showNameEditor) {
        return (
            <input
                ref={nameInputRef}
                type="text"
                className="v-history-table-name-input"
                value={nameValue}
                onChange={(event) => setNameValue(event.target.value)}
                placeholder="Commit name..."
                aria-label="Name input"
                onKeyDown={handleNameInputKeyDown}
                onClick={(event) => event.stopPropagation()}
                maxLength={MAX_NAME_LENGTH}
            />
        );
    }

    return version.name
        ? (
            <span className="v-history-table-name">
                <HighlightedText
                    text={version.name}
                    {...(searchQuery && { query: searchQuery })}
                    caseSensitive={isSearchCaseSensitive}
                />
            </span>
        )
        : <span className="v-history-table-empty">{emptyLabel}</span>;
};

interface HistoryTableRowProps {
    row: Row<VersionHistoryEntry>;
    visibleCellCount: number;
    searchQuery: string;
    isSearchCaseSensitive: boolean;
    viewMode: ViewMode;
    enableVersionNaming: boolean;
    enableVersionDescription: boolean;
}

export const HistoryTableRow: FC<HistoryTableRowProps> = memo(({
    row,
    visibleCellCount,
    searchQuery,
    isSearchCaseSensitive,
    viewMode,
    enableVersionNaming,
    enableVersionDescription,
}) => {
    const version = row.original;
    const { namingVersionId, highlightedVersionId, isManualVersionEdit } = useAppSelector(state => ({
        namingVersionId: state.app.namingVersionId,
        highlightedVersionId: state.app.highlightedVersionId,
        isManualVersionEdit: state.app.isManualVersionEdit,
    }));
    const rowGroupRef = useRef<HTMLTableSectionElement | null>(null);
    const nameInputRef = useRef<HTMLInputElement | null>(null);
    const descTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const reactId = useId();
    const descriptionId = `v-history-description-${reactId.replace(/:/g, '')}`;

    const isNamingThisVersion = namingVersionId === version.id;
    const hasDescription = Boolean(version.description?.trim());
    const { nameValue, setNameValue, descValue, setDescValue, ignoreBlurRef } = useEntryEdit(
        isNamingThisVersion,
        version,
        descTextareaRef
    );
    const {
        handleMouseDown,
        handleEntryClick,
        handleContextMenu,
        handleKeyDown,
        handleContainerBlur,
        handleNameInputKeyDown,
        handleDescTextareaKeyDown,
    } = useEntryActions(
        version,
        viewMode,
        namingVersionId,
        isNamingThisVersion,
        nameValue,
        descValue,
        rowGroupRef,
        ignoreBlurRef
    );

    useEntryHighlight(
        isNamingThisVersion,
        nameInputRef,
        descTextareaRef,
        isManualVersionEdit,
        enableVersionNaming
    );

    const showNameEditor = isNamingThisVersion && (isManualVersionEdit || enableVersionNaming);
    const showDescriptionEditor = isNamingThisVersion && (isManualVersionEdit || enableVersionDescription);
    const showDescriptionRow = showDescriptionEditor || (hasDescription && row.getIsExpanded());

    const contextValue = useMemo<HistoryTableRowContextValue>(() => ({
        version,
        hasDescription,
        isDescriptionExpanded: row.getIsExpanded(),
        descriptionId,
        showNameEditor,
        isEditing: isNamingThisVersion,
        searchQuery,
        isSearchCaseSensitive,
        nameValue,
        setNameValue,
        nameInputRef,
        handleNameInputKeyDown,
        toggleDescription: row.getToggleExpandedHandler(),
    }), [
        descriptionId,
        handleNameInputKeyDown,
        hasDescription,
        nameValue,
        row,
        isNamingThisVersion,
        isSearchCaseSensitive,
        searchQuery,
        showNameEditor,
        version,
    ]);

    return (
        <HistoryTableRowContext.Provider value={contextValue}>
            <tbody
                ref={rowGroupRef}
                className={clsx('v-history-table-row-group', {
                    'is-highlighted': version.id === highlightedVersionId,
                    'is-naming': isNamingThisVersion,
                    'is-expanded': showDescriptionRow,
                })}
                data-version-id={version.id}
                onClick={handleEntryClick}
                onMouseDown={handleMouseDown}
                onContextMenu={handleContextMenu}
                onKeyDown={handleKeyDown}
                onBlur={isNamingThisVersion ? handleContainerBlur : undefined}
            >
                <tr
                    className="v-history-table-row"
                    tabIndex={0}
                    aria-selected={version.id === highlightedVersionId}
                >
                    {row.getVisibleCells().map(cell => (
                        <td key={cell.id} data-column-id={cell.column.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                    ))}
                </tr>
                {showDescriptionRow && (
                    <tr className="v-history-table-description-row">
                        <td colSpan={visibleCellCount}>
                            {showDescriptionEditor ? (
                                <EntryEditor
                                    isVisible
                                    descValue={descValue}
                                    setDescValue={setDescValue}
                                    placeholderDesc={viewMode === 'edits' ? 'Edit description...' : 'Version description...'}
                                    handleDescTextareaKeyDown={handleDescTextareaKeyDown}
                                    descTextareaRef={descTextareaRef}
                                />
                            ) : (
                                <div id={descriptionId} className="v-history-table-description" role="region" aria-label="Description">
                                    <HighlightedText
                                        text={version.description ?? ''}
                                        {...(searchQuery && { query: searchQuery })}
                                        caseSensitive={isSearchCaseSensitive}
                                    />
                                </div>
                            )}
                        </td>
                    </tr>
                )}
            </tbody>
        </HistoryTableRowContext.Provider>
    );
});

HistoryTableRow.displayName = 'HistoryTableRow';
