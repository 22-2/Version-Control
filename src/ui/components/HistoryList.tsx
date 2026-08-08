import { moment } from 'obsidian';
import { orderBy } from 'es-toolkit';
import clsx from 'clsx';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    flexRender,
    getCoreRowModel,
    getExpandedRowModel,
    getSortedRowModel,
    useReactTable,
    type ColumnDef,
    type ExpandedState,
    type OnChangeFn,
    type SortingState,
} from '@tanstack/react-table';
import { AppStatus, appSlice, type SortProperty } from '@/state';
import type { VersionHistoryEntry, ViewMode } from '@/types';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { useTime } from '@/ui/contexts';
import { formatFileSize } from '@/ui/utils/dom';
import { Icon } from '@/ui/components/Icon';
import { HighlightedText } from '@/ui/components/shared/HighlightedText';
import {
    HistoryDescriptionToggleCell,
    HistoryNameCell,
    HistoryTableRow,
} from '@/ui/components/HistoryTableRow';
import { formatTimestamp, getDisplaySize, getStatCounts } from '@/ui/components/HistoryEntry/utils';
import { useGetVersionHistoryQuery, useGetEditHistoryQuery } from '@/state/apis/history.api';

const SORTABLE_COLUMN_IDS = new Set<SortProperty>(['versionNumber', 'timestamp', 'name', 'size']);

const HistoryTimestampCell: FC<{
    version: VersionHistoryEntry;
    searchQuery: string;
    isSearchCaseSensitive: boolean;
    useRelativeTimestamps: boolean;
}> = ({ version, searchQuery, isSearchCaseSensitive, useRelativeTimestamps }) => {
    const { now } = useTime();
    const { timestampText, tooltipTimestamp } = formatTimestamp(version.timestamp, useRelativeTimestamps, now);

    return (
        <span title={tooltipTimestamp}>
            <HighlightedText
                text={timestampText}
                {...(searchQuery && { query: searchQuery })}
                caseSensitive={isSearchCaseSensitive}
            />
        </span>
    );
};

const EmptyState: FC<{ icon: string; title: string; subtitle?: string }> = ({ icon, title, subtitle }) => (
    <motion.div
        className="v-empty-state"
        role="status"
        aria-live="polite"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
    >
        <div className="v-empty-state-icon"><Icon name={icon} /></div>
        <p className="v-empty-state-title">{title}</p>
        {subtitle && <p className="v-empty-state-subtitle v-meta-label">{subtitle}</p>}
    </motion.div>
);

function safeFormatTimestamp(raw: unknown, formatStr = 'LLLL'): string {
    try {
        return (moment as any)(raw).format(formatStr);
    } catch {
        const date = new Date(String(raw));
        return Number.isNaN(date.getTime()) ? '' : date.toISOString();
    }
}

interface HistoryListProps {
    onCountChange: (filteredCount: number, totalCount: number) => void;
}

export const HistoryList: FC<HistoryListProps> = ({ onCountChange }) => {
    const dispatch = useAppDispatch();
    const status = useAppSelector(state => state.app.status);
    const noteId = useAppSelector(state => state.app.noteId);
    const viewMode = useAppSelector(state => state.app.viewMode);
    const searchQuery = useAppSelector(state => state.app.searchQuery ?? '');
    const isSearchCaseSensitive = useAppSelector(state => state.app.isSearchCaseSensitive);
    const sortOrder = useAppSelector(state => state.app.sortOrder ?? { property: 'versionNumber', direction: 'desc' });
    const settings = useAppSelector(state => state.app.effectiveSettings);
    const enableCompression = useAppSelector(state => state.app.settings.enableCompression);
    const isPanelOpen = useAppSelector(state => state.app.panel !== null);

    const skipQuery = !noteId;
    const versionHistoryQuery = useGetVersionHistoryQuery(noteId!, {
        skip: skipQuery || viewMode !== 'versions',
    });
    const editHistoryQuery = useGetEditHistoryQuery(noteId!, {
        skip: skipQuery || viewMode !== 'edits',
    });
    const { data: queryData, isFetching, isLoading } = viewMode === 'versions'
        ? versionHistoryQuery
        : editHistoryQuery;
    const activeList = noteId ? queryData : undefined;
    const trimmedQuery = searchQuery.trim();
    const isSearching = trimmedQuery.length > 0;

    const filteredHistory = useMemo(() => {
        if (isLoading || isFetching || !activeList) return [];

        const source = Array.isArray(activeList) ? activeList : [];
        if (!isSearching) return source;

        const query = isSearchCaseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();
        const check = (value: string) => isSearchCaseSensitive ? value : value.toLowerCase();
        const prefix = viewMode === 'edits' ? 'E' : 'V';
        const scored = source.map(version => {
            let score = 0;
            const commitId = `${prefix}${version.versionNumber ?? ''}`;
            const name = String(version.name ?? '');
            const description = String(version.description ?? '');
            const size = formatFileSize(getDisplaySize(enableCompression, version));
            const timestamp = settings.useRelativeTimestamps
                ? (() => { try { return (moment as any)(version.timestamp).fromNow(true); } catch { return ''; } })()
                : safeFormatTimestamp(version.timestamp);
            const { wordCount, charCount, lineCount } = getStatCounts(version, settings);

            if (check(commitId) === query) score += 100;
            else if (check(commitId).includes(query)) score += 80;
            if (check(name).startsWith(query)) score += 60;
            else if (check(name).includes(query)) score += 50;
            if (check(description).includes(query)) score += 40;
            if (check(size).includes(query)) score += 20;
            if (check(timestamp).includes(query)) score += 20;
            if (settings.enableWordCount && check(String(wordCount ?? '')) === query) score += 15;
            if (settings.enableCharacterCount && check(String(charCount ?? '')) === query) score += 15;
            if (settings.enableLineCount && check(String(lineCount ?? '')) === query) score += 15;

            return { version, score };
        });

        return orderBy(scored.filter(item => item.score > 0), ['score'], ['desc'])
            .map(item => item.version);
    }, [
        activeList,
        enableCompression,
        isFetching,
        isLoading,
        isSearchCaseSensitive,
        isSearching,
        settings,
        trimmedQuery,
        viewMode,
    ]);

    const columns = useMemo<ColumnDef<VersionHistoryEntry>[]>(() => {
        const prefix = viewMode === 'edits' ? 'E' : 'V';
        const baseColumns: ColumnDef<VersionHistoryEntry>[] = [
            {
                id: 'descriptionToggle',
                header: '',
                cell: () => <HistoryDescriptionToggleCell />,
                enableSorting: false,
                size: 36,
            },
            {
                accessorKey: 'versionNumber',
                header: 'Commit',
                cell: ({ row }) => (
                    <span className="v-history-table-commit">
                        <HighlightedText
                            text={`${prefix}${row.original.versionNumber}`}
                            {...(searchQuery && { query: searchQuery })}
                            caseSensitive={isSearchCaseSensitive}
                        />
                    </span>
                ),
                sortDescFirst: true,
                size: 72,
            },
            {
                id: 'name',
                accessorFn: row => row.name?.toLocaleLowerCase() || '\uffff',
                header: 'Name',
                cell: () => <HistoryNameCell />,
                sortDescFirst: false,
                size: 240,
            },
            {
                id: 'timestamp',
                accessorFn: row => Date.parse(row.timestamp) || 0,
                header: 'Date',
                cell: ({ row }) => (
                    <HistoryTimestampCell
                        version={row.original}
                        searchQuery={searchQuery}
                        isSearchCaseSensitive={isSearchCaseSensitive}
                        useRelativeTimestamps={settings.useRelativeTimestamps}
                    />
                ),
                sortDescFirst: true,
                size: 152,
            },
            {
                id: 'size',
                accessorFn: row => getDisplaySize(enableCompression, row),
                header: 'Size',
                cell: ({ getValue }) => {
                    const value = formatFileSize(Number(getValue()));
                    return <HighlightedText text={value} {...(searchQuery && { query: searchQuery })} caseSensitive={isSearchCaseSensitive} />;
                },
                sortDescFirst: true,
                size: 88,
            },
        ];

        const statColumns: ColumnDef<VersionHistoryEntry>[] = [];
        if (settings.enableWordCount) {
            statColumns.push({
                id: 'words',
                accessorFn: row => getStatCounts(row, settings).wordCount ?? 0,
                header: 'Words',
                cell: ({ getValue }) => String(getValue()),
                enableSorting: false,
                size: 76,
            });
        }
        if (settings.enableCharacterCount) {
            statColumns.push({
                id: 'characters',
                accessorFn: row => getStatCounts(row, settings).charCount ?? 0,
                header: 'Chars',
                cell: ({ getValue }) => String(getValue()),
                enableSorting: false,
                size: 76,
            });
        }
        if (settings.enableLineCount) {
            statColumns.push({
                id: 'lines',
                accessorFn: row => getStatCounts(row, settings).lineCount ?? 0,
                header: 'Lines',
                cell: ({ getValue }) => String(getValue()),
                enableSorting: false,
                size: 70,
            });
        }
        return [...baseColumns, ...statColumns];
    }, [enableCompression, isSearchCaseSensitive, searchQuery, settings, viewMode]);

    const sorting = useMemo<SortingState>(() => isSearching ? [] : [{
        id: sortOrder.property,
        desc: sortOrder.direction === 'desc',
    }], [isSearching, sortOrder.direction, sortOrder.property]);
    const [expanded, setExpanded] = useState<ExpandedState>({});

    useEffect(() => {
        if (!settings.showDescriptionInList && !isSearching) {
            setExpanded({});
            return;
        }
        const expandedRows = Object.fromEntries(
            filteredHistory
                .filter(version => Boolean(version.description?.trim()))
                .map(version => [version.id, true])
        );
        setExpanded(expandedRows);
    }, [filteredHistory, isSearching, noteId, settings.showDescriptionInList, trimmedQuery, viewMode]);

    const handleSortingChange = useCallback<OnChangeFn<SortingState>>((updater) => {
        const nextSorting = typeof updater === 'function' ? updater(sorting) : updater;
        const next = nextSorting[0];
        if (!next || !SORTABLE_COLUMN_IDS.has(next.id as SortProperty)) return;
        dispatch(appSlice.actions.setSortOrder({
            property: next.id as SortProperty,
            direction: next.desc ? 'desc' : 'asc',
        }));
    }, [dispatch, sorting]);

    const table = useReactTable({
        data: filteredHistory,
        columns,
        state: { sorting, expanded },
        onSortingChange: handleSortingChange,
        onExpandedChange: setExpanded,
        getRowId: row => row.id,
        getRowCanExpand: row => Boolean(row.original.description?.trim()),
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        enableMultiSort: false,
        enableSortingRemoval: false,
        enableSorting: !isSearching,
    });

    useEffect(() => {
        const total = Array.isArray(activeList) ? activeList.length : 0;
        onCountChange(filteredHistory.length, total);
    }, [activeList, filteredHistory.length, onCountChange]);

    const total = Array.isArray(activeList) ? activeList.length : 0;
    const visibleCellCount = table.getVisibleLeafColumns().length;

    const renderHeader = () => (
        <thead>
            {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => {
                        const sorted = header.column.getIsSorted();
                        const ariaSort = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
                        return (
                            <th
                                key={header.id}
                                data-column-id={header.column.id}
                                aria-sort={header.column.getCanSort() ? ariaSort : undefined}
                                style={{ width: header.getSize() }}
                            >
                                {header.isPlaceholder ? null : header.column.getCanSort() ? (
                                    <div
                                        className="v-history-table-sort"
                                        role="button"
                                        tabIndex={0}
                                        onClick={header.column.getToggleSortingHandler()}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                header.column.toggleSorting();
                                            }
                                        }}
                                        title={`Sort by ${String(header.column.columnDef.header)}`}
                                    >
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {sorted && <Icon name={sorted === 'asc' ? 'arrow-up' : 'arrow-down'} />}
                                    </div>
                                ) : flexRender(header.column.columnDef.header, header.getContext())}
                            </th>
                        );
                    })}
                </tr>
            ))}
        </thead>
    );

    const renderContent = () => {
        if (isLoading || isFetching || status === AppStatus.LOADING) {
            return (
                <div key="loading" className="v-history-table-scroll">
                    <table className="v-history-table is-loading">
                        {renderHeader()}
                        <tbody>
                            {Array.from({ length: 8 }, (_, index) => (
                                <tr key={index} aria-hidden>
                                    {table.getVisibleLeafColumns().map(column => (
                                        <td key={column.id} data-column-id={column.id}>
                                            <span className="v-history-table-skeleton v-skeleton-item" />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
        }

        if (status !== AppStatus.READY) return null;
        if (total === 0) {
            const noun = viewMode === 'versions' ? 'versions' : 'edits';
            const action = viewMode === 'versions' ? 'track history' : 'track edits';
            return <EmptyState key="empty" icon="inbox" title={`No ${noun} saved yet.`} subtitle={`Click the '+' button to start ${action} for this note.`} />;
        }
        if (filteredHistory.length === 0 && isSearching) {
            return <EmptyState key="no-results" icon="search-x" title="No matching items found." subtitle="Try a different search query." />;
        }

        return (
            <motion.div
                key={`table-${viewMode}`}
                className="v-history-table-scroll"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
            >
                <table className={clsx('v-history-table', { 'is-compact': settings.isListView })}>
                    {renderHeader()}
                    {table.getRowModel().rows.map(row => (
                        <HistoryTableRow
                            key={row.id}
                            row={row}
                            visibleCellCount={visibleCellCount}
                            searchQuery={searchQuery}
                            isSearchCaseSensitive={isSearchCaseSensitive}
                            viewMode={viewMode as ViewMode}
                            enableVersionNaming={settings.enableVersionNaming}
                            enableVersionDescription={settings.enableVersionDescription}
                        />
                    ))}
                </table>
            </motion.div>
        );
    };

    return (
        <div className={clsx('v-history-list-container', { 'is-panel-active': isPanelOpen })}>
            <div className="v-history-list">
                <AnimatePresence mode="wait">{renderContent()}</AnimatePresence>
            </div>
        </div>
    );
};
