import { type FC, useState, useCallback } from 'react';
import { Menu } from 'obsidian';
import { useAppDispatch, useAppSelector } from '@/ui/hooks';
import { appSlice } from '@/state';
import { GlobalSettings } from './GlobalSettings';
import { NoteSettingsControls } from './setting-controls/NoteSettingsControls';
import { AutoRegisterSettings } from './setting-controls/AutoRegisterSettings';
import { Icon } from '@/ui/components';

type SettingsTabId = 'general' | 'versions' | 'edits';

export const SettingsTabRoot: FC = () => {
    const dispatch = useAppDispatch();
    const [activeTab, setActiveTab] = useState<SettingsTabId>('general');
    
    const versionDefaults = useAppSelector(state => state.app.settings.versionHistorySettings);
    const editDefaults = useAppSelector(state => state.app.settings.editHistorySettings);

    const handleTabChange = useCallback((tabId: SettingsTabId) => {
        setActiveTab(tabId);
        
        if (tabId === 'versions') {
            dispatch(appSlice.actions.setViewMode('versions'));
            dispatch(appSlice.actions.updateEffectiveSettings({ ...versionDefaults, isGlobal: true }));
        } else if (tabId === 'edits') {
            dispatch(appSlice.actions.setViewMode('edits'));
            dispatch(appSlice.actions.updateEffectiveSettings({ ...editDefaults, isGlobal: true }));
        }
    }, [dispatch, versionDefaults, editDefaults]);

    const getTabLabel = (id: SettingsTabId) => {
        switch (id) {
            case 'general': return 'General';
            case 'versions': return 'Version History';
            case 'edits': return 'Edit History';
        }
    };

    const handleOpenTabMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();

        const menu = new Menu();
        const tabs: { id: SettingsTabId; label: string }[] = [
            { id: 'general', label: 'General' },
            { id: 'versions', label: 'Version History' },
            { id: 'edits', label: 'Edit History' },
        ];

        tabs.forEach(({ id, label }) => {
            menu.addItem(item => {
                item
                    .setTitle(label)
                    .setChecked(activeTab === id)
                    .onClick(() => handleTabChange(id));
            });
        });

        menu.showAtMouseEvent(event.nativeEvent);
    }, [activeTab, handleTabChange]);

    return (
        <div className="v-settings-tab-content">
            <div className="v-settings-tab-header">
                <button className="v-settings-nav-button" onClick={handleOpenTabMenu}>
                    <span>{getTabLabel(activeTab)}</span>
                    <Icon name="chevron-down" />
                </button>
            </div>

            {activeTab === 'general' && (
                <div role="tabpanel" id="tab-panel-general">
                    <GlobalSettings showTitle={false} showDefaults={false} />
                </div>
            )}

            {activeTab === 'versions' && (
                <div role="tabpanel" id="tab-panel-versions" className="v-settings-section">
                    <h2>Global Version History Defaults</h2>
                    <p className="setting-item-description">
                        These settings apply to all notes using Version History unless overridden by specific note settings.
                    </p>
                    
                    <div style={{ marginBottom: 'var(--size-4-4)' }}>
                         <AutoRegisterSettings settingKey="versionHistorySettings" />
                    </div>
                    
                    <NoteSettingsControls disabled={false} />
                </div>
            )}

            {activeTab === 'edits' && (
                <div role="tabpanel" id="tab-panel-edits" className="v-settings-section">
                    <h2>Global Edit History Defaults</h2>
                    <p className="setting-item-description">
                        These settings apply to all notes using Edit History unless overridden by specific note settings.
                    </p>
                    
                    <div style={{ marginBottom: 'var(--size-4-4)' }}>
                        <AutoRegisterSettings settingKey="editHistorySettings" />
                    </div>

                    <NoteSettingsControls disabled={false} />
                </div>
            )}
        </div>
    );
};
