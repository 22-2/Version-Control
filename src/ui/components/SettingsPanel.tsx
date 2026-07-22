import clsx from 'clsx';
import { Menu } from 'obsidian';
import { type FC, memo, useState, useEffect, type SyntheticEvent, useCallback } from 'react';
import { useAppDispatch, useAppSelector, useObsidianComponent } from '@/ui/hooks';
import { GlobalSettings } from './settings/GlobalSettings';
import { NoteSpecificSettings } from './settings/NoteSpecificSettings';
import { Icon } from '@/ui/components';
import { appSlice } from '@/state';
import { useNoteActions } from '@/ui/hooks/useNoteActions';

// Helper to aggressively stop event propagation to prevent "click-through" issues
const stopPropagation = (e: SyntheticEvent) => {
    e.stopPropagation();
    e.nativeEvent?.stopImmediatePropagation?.();
};

const SettingsPanelComponent: FC = () => {
    const dispatch = useAppDispatch();
    const isActive = useAppSelector(state => state.app.panel?.type === 'settings');
    const viewMode = useAppSelector(state => state.app.viewMode);
    
    const [isAdvancedMode, setIsAdvancedMode] = useState(false);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    // Manage Obsidian Component lifecycle for window events
    const component = useObsidianComponent();

    const {
        handleRefresh,
        handleExport,
        handleDeleteAll,
        handleViewChangelog,
        handleReportIssue,
        hasItems,
        deleteLabel,
        noteId
    } = useNoteActions();

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        // Use Component to register DOM events for automatic cleanup
        component.registerDomEvent(window, 'online', handleOnline);
        component.registerDomEvent(window, 'offline', handleOffline);

        // No explicit cleanup return needed as component.unload() handles it
    }, [component]);

    const handleOpenSettingsMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        stopPropagation(event);

        const menu = new Menu();
        menu.addItem(item => item.setTitle('Actions').setIsLabel(true));
        menu.addItem(item => item.setTitle('Refresh history').setIcon('refresh-cw').onClick(handleRefresh));
        menu.addItem(item => item
            .setTitle('Export history')
            .setIcon('download-cloud')
            .setDisabled(!noteId)
            .onClick(handleExport));
        menu.addSeparator();
        menu.addItem(item => item.setTitle('View changelog').setIcon('file-text').onClick(handleViewChangelog));
        menu.addItem(item => item.setTitle('Report issue').setIcon('bug').onClick(handleReportIssue));
        menu.addSeparator();
        menu.addItem(item => item
            .setTitle(deleteLabel)
            .setIcon('trash-2')
            .setWarning(true)
            .setDisabled(!noteId || !hasItems)
            .onClick(handleDeleteAll));
        menu.addSeparator();
        menu.addItem(item => item
            .setTitle(isAdvancedMode ? 'Basic settings' : 'Advanced settings')
            .onClick(() => setIsAdvancedMode(value => !value)));

        menu.showAtMouseEvent(event.nativeEvent);
    }, [deleteLabel, handleDeleteAll, handleExport, handleRefresh, handleReportIssue, handleViewChangelog, hasItems, isAdvancedMode, noteId]);

    const settingsMenu = (
        <button
            className="clickable-icon"
            aria-label="Settings options"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleOpenSettingsMenu}
        >
            <Icon name="more-horizontal" />
        </button>
    );

    return (
        <div 
            className={clsx("v-settings-panel", { "is-active": isActive })}
            role="dialog"
            aria-modal={isActive}
            onPointerDown={stopPropagation}
            onMouseDown={stopPropagation}
            onMouseUp={stopPropagation}
            onClick={stopPropagation}
        >
            <div 
                className="v-settings-panel-header"
                onPointerDown={stopPropagation}
                onMouseDown={stopPropagation}
                onClick={stopPropagation}
            >
                <div className="v-settings-header-title-group">
                    <h3>Settings</h3>
                    {isOnline && (
                        <img 
                            src="https://img.shields.io/github/v/release/Yuichi-Aragi/Version-Control" 
                            alt="GitHub Release" 
                            className="v-settings-badge"
                        />
                    )}
                </div>
                <div className="v-panel-header-actions">
                    <button 
                        className="clickable-icon v-panel-close" 
                        aria-label="Close settings" 
                        onClick={(e) => {
                            stopPropagation(e);
                            dispatch(appSlice.actions.closePanel());
                        }}
                        onMouseDown={stopPropagation}
                    >
                        <Icon name="x" />
                    </button>
                </div>
            </div>
            <div className="v-settings-panel-content-wrapper">
                {isAdvancedMode ? (
                    <GlobalSettings 
                        showTitle={true} 
                        showPluginSettings={true} 
                        showDefaults={false}
                        headerAction={settingsMenu}
                    />
                ) : (
                    <>
                        <NoteSpecificSettings headerAction={settingsMenu} />
                        <GlobalSettings 
                            showTitle={false} 
                            showPluginSettings={false} 
                            showDefaults={true}
                            activeViewMode={viewMode}
                        />
                    </>
                )}
            </div>
        </div>
    );
};

export const SettingsPanel = memo(SettingsPanelComponent);
SettingsPanel.displayName = 'SettingsPanel';
