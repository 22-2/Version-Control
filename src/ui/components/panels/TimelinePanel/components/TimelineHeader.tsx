import type { FC } from 'react';
import clsx from 'clsx';
import { Menu } from 'obsidian';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { thunks } from '@/state';
import { Icon } from '@/ui/components';
import type { TimelineHeaderProps } from '@/ui/components/panels/TimelinePanel/types';
import { TimelineFilters } from '@/ui/components/panels/TimelinePanel/components/TimelineFilters';

export const TimelineHeader: FC<TimelineHeaderProps> = ({
    viewMode,
    settings,
    searchState,
    matchController,
    onNavigateMatch
}) => {
    const dispatch = useAppDispatch();
    const { isProcessing, isRenaming } = useAppSelector(state => ({
        isProcessing: state.app.isProcessing,
        isRenaming: state.app.isRenaming,
    }));

    const isBusy = isProcessing || isRenaming;
    const timelineTitle = viewMode === 'versions' ? 'Version Timeline' : 'Edit Timeline';
    const switchViewLabel = viewMode === 'versions' ? 'Switch to Edit History' : 'Switch to Version History';

    const handleToggleViewMode = () => dispatch(thunks.toggleViewMode());
    const handleOpenBranchDrawer = () => dispatch(thunks.showBranchSwitcher());
    const handleOpenDashboard = () => dispatch(thunks.openDashboard());
    const handleOpenMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();

        const menu = new Menu();
        menu.addItem(item => item
            .setTitle(switchViewLabel)
            .setIcon(viewMode === 'versions' ? 'file-edit' : 'history')
            .onClick(handleToggleViewMode));
        menu.addSeparator();
        menu.addItem(item => item.setTitle('Branches').setIcon('git-branch').onClick(handleOpenBranchDrawer));
        menu.addItem(item => item.setTitle('Dashboard').setIcon('layout-dashboard').onClick(handleOpenDashboard));
        menu.showAtMouseEvent(event.nativeEvent);
    };

    return (
        <div className="v-timeline-header-container">
            <div className={clsx("v-timeline-toolbar", { "is-searching": searchState.isSearchActive })}>
                {/* Normal Toolbar Content */}
                <div className="v-timeline-toolbar-content">
                    <button
                        className="clickable-icon"
                        aria-label="Menu"
                        disabled={isBusy}
                        onClick={handleOpenMenu}
                    >
                        <Icon name="menu" />
                    </button>

                    <div className="v-timeline-header-actions">
                        <button className="clickable-icon" onClick={searchState.handleToggleSearch} aria-label="Search">
                            <Icon name="search" />
                        </button>
                        <TimelineFilters settings={settings} />
                    </div>
                </div>

                {/* Search Bar Overlay - Matches ActionBar structure exactly */}
                <div className={clsx("v-search-bar-container", { "is-query-active": searchState.localSearchQuery.trim().length > 0 })}>
                    <div className="v-search-input-wrapper">
                        <div className="v-search-icon" role="button" onClick={searchState.handleToggleSearch}>
                            <Icon name="arrow-left" />
                        </div>
                        <input
                            ref={searchState.searchInputRef}
                            type="search"
                            placeholder="Search timeline..."
                            value={searchState.localSearchQuery}
                            onChange={searchState.handleSearchInputChange}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onNavigateMatch(e.shiftKey ? 'prev' : 'next');
                                }
                                if (e.key === 'Escape') searchState.handleToggleSearch();
                            }}
                        />
                        <div className="v-search-input-buttons">
                            {searchState.searchQuery && matchController.totalMatches > 0 && (
                                <span className="v-search-match-count">
                                    {matchController.activeIndex + 1} / {matchController.totalMatches}
                                </span>
                            )}
                            <button
                                className="clickable-icon"
                                disabled={matchController.totalMatches === 0}
                                onClick={() => onNavigateMatch('prev')}
                            >
                                <Icon name="chevron-up" />
                            </button>
                            <button
                                className="clickable-icon"
                                disabled={matchController.totalMatches === 0}
                                onClick={() => onNavigateMatch('next')}
                            >
                                <Icon name="chevron-down" />
                            </button>
                            <button
                                className={clsx('clickable-icon', { 'is-active': searchState.isCaseSensitive })}
                                onClick={searchState.toggleCaseSensitivity}
                            >
                                <Icon name="case-sensitive" />
                            </button>
                            <button
                                className={clsx('clickable-icon', { 'v-is-hidden': !searchState.localSearchQuery })}
                                onClick={searchState.handleClearSearch}
                            >
                                <Icon name="x" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="v-timeline-header-title-row">
                <h3>{timelineTitle}</h3>
            </div>
        </div>
    );
};
