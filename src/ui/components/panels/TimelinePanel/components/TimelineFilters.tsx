import type { FC } from 'react';
import { Menu } from 'obsidian';
import { useAppSelector } from '@/ui/hooks';
import { Icon } from '@/ui/components';
import type { TimelineFiltersProps } from '@/ui/components/panels/TimelinePanel/types';
import type { TimelineSettings } from '@/types';
import { useUpdateTimelineSettingsMutation } from '@/state/apis/history.api';

export const TimelineFilters: FC<TimelineFiltersProps> = ({ settings }) => {
    const noteId = useAppSelector(state => state.app.noteId);
    const currentBranch = useAppSelector(state => state.app.currentBranch);
    const viewMode = useAppSelector(state => state.app.viewMode);

    const [updateSettings] = useUpdateTimelineSettingsMutation();

    const toggle = (key: keyof TimelineSettings) => {
        if (!noteId || !currentBranch) return;
        
        updateSettings({
            noteId,
            branchName: currentBranch,
            viewMode,
            settings: { [key]: !settings[key] }
        });
    };

    const handleOpenMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();

        const menu = new Menu();
        const filters: { key: keyof TimelineSettings; title: string }[] = [
            { key: 'showName', title: 'Show Name' },
            { key: 'showVersionNumber', title: 'Show Version Number' },
            { key: 'showDescription', title: 'Show Description' },
            { key: 'showPreview', title: 'Show Preview' },
            { key: 'expandByDefault', title: 'Expand Cards by Default' },
        ];

        filters.forEach(({ key, title }) => {
            menu.addItem(item => item
                .setTitle(title)
                .setChecked(settings[key])
                .onClick(() => toggle(key)));
        });
        menu.showAtMouseEvent(event.nativeEvent);
    };

    return (
        <button className="clickable-icon" aria-label="Timeline Settings" onClick={handleOpenMenu}>
            <Icon name="settings-2" />
        </button>
    );
};
