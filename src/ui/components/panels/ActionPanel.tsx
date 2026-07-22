import { debounce, Menu } from 'obsidian';
import clsx from 'clsx';
import { type FC, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useAppDispatch } from '@/ui/hooks';
import type { ActionPanel as ActionPanelState, ActionItem } from '@/state';
import { Icon } from '@/ui/components';
import { usePanelClose } from '@/ui/hooks';
import { useBackdropClick } from '@/ui/hooks';
import { useDelayedFocus } from '@/ui/hooks';

interface ActionPanelProps {
    panelState: ActionPanelState<any>;
}

const ITEM_HEIGHT = 52; // Card height + padding-bottom

interface ItemComponentProps {
    item: ActionItem<any>;
    isFocused: boolean;
    isDrawer: boolean;
    contextActions?: ActionItem<string>[] | undefined;
    onChoose: () => void;
    onFocus: () => void;
    onContextAction?: (actionId: string) => void;
}

const ItemComponent: FC<ItemComponentProps> = memo(({ item, isFocused, isDrawer, contextActions, onChoose, onFocus, onContextAction }) => {
    const itemRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isFocused) {
            itemRef.current?.focus({ preventScroll: true });
        }
    }, [isFocused]);

    const iconToShow = item.isSelected ? 'check' : item.icon;

    const handleContextMenu = useCallback((event: React.MouseEvent) => {
        if (!contextActions || contextActions.length === 0) return;

        event.preventDefault();
        event.stopPropagation();

        const menu = new Menu();
        contextActions.forEach(action => {
            menu.addItem(menuItem => {
                menuItem
                    .setTitle(action.text)
                    .setIcon(action.icon ?? null)
                    .onClick(() => onContextAction?.(action.id));
            });
        });
        menu.showAtMouseEvent(event.nativeEvent);
    }, [contextActions, onContextAction]);

    // Helper to render the trigger icon if actions exist
    const renderTrigger = () => {
        if (!contextActions || contextActions.length === 0) return null;
        
        return (
            <button
                type="button"
                className="clickable-icon v-action-item-more"
                aria-label={`More options for ${item.text}`}
                onClick={handleContextMenu}
            >
                <Icon name="more-vertical" />
            </button>
        );
    };

    const content = (
        <div
            ref={itemRef}
            className={clsx('v-action-panel-item', { 'is-selected': item.isSelected })}
            tabIndex={-1}
            onClick={(e) => {
                e.stopPropagation();
                onChoose();
            }}
            onFocus={onFocus}
            onContextMenu={handleContextMenu}
        >
            {iconToShow && (
                <span className="v-action-item-icon">
                    <Icon name={iconToShow} />
                </span>
            )}
            <div className="v-action-item-text-wrapper">
                <div className="v-action-item-text">{item.text}</div>
                {item.subtext && <div className="v-action-item-subtext">{item.subtext}</div>}
            </div>
            {renderTrigger()}
        </div>
    );

    return isDrawer ? <div className="v-action-panel-list-item-wrapper">{content}</div> : content;
});
ItemComponent.displayName = 'ActionPanelItem';

export const ActionPanel: FC<ActionPanelProps> = ({ panelState }) => {
    const dispatch = useAppDispatch();
    const [filterQuery, setFilterQuery] = useState('');
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const filterInputRef = useRef<HTMLInputElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    const { items, onCreateAction, contextActions, onContextAction } = panelState;
    // FIX: Use a more robust check for drawer mode that is resilient to whitespace.
    const isDrawer = panelState.title?.trim() === 'Switch or create branch';

    const filteredItems = useMemo(() => {
        const query = filterQuery.trim();
        const lowerCaseQuery = query.toLowerCase();

        const results = items.filter(item =>
            item.text.toLowerCase().includes(lowerCaseQuery) ||
            (item.subtext && item.subtext.toLowerCase().includes(lowerCaseQuery))
        );

        if (onCreateAction && query && !items.some(item => item.text.toLowerCase() === lowerCaseQuery)) {
            results.push({
                id: '__create__',
                data: query,
                text: `Create new "${query}"`,
                icon: 'plus-circle'
            });
        }
        
        return results;
    }, [items, filterQuery, onCreateAction]);

    const handleClose = usePanelClose();
    const handleBackdropClick = useBackdropClick(handleClose);
    
    const chooseItem = useCallback((item: any) => {
        if (item.id === '__create__' && onCreateAction) {
            dispatch(onCreateAction(item.data));
        } else {
            dispatch(panelState.onChooseAction(item.data));
        }
    }, [dispatch, panelState.onChooseAction, onCreateAction]);

    const handleContextAction = useCallback((actionId: string, itemData: any) => {
        if (onContextAction) {
            dispatch(onContextAction(actionId, itemData));
        }
    }, [dispatch, onContextAction]);

    const debouncedSetFilter = useMemo(() => debounce(setFilterQuery, 150, true), []);

    useDelayedFocus(filterInputRef);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (filteredItems.length === 0) return;

        let nextIndex = focusedIndex;
        let shouldPreventDefault = true;

        if (e.key === 'ArrowDown') {
            nextIndex = focusedIndex < 0 ? 0 : (focusedIndex + 1) % filteredItems.length;
        } else if (e.key === 'ArrowUp') {
            if (document.activeElement === filterInputRef.current) {
                shouldPreventDefault = false; // Allow native cursor movement
            } else {
                nextIndex = focusedIndex <= 0 ? filteredItems.length - 1 : focusedIndex - 1;
            }
        } else if (e.key === 'Escape') {
            handleClose();
        } else if (e.key === 'Enter' || e.key === ' ') {
            const activeItem = filteredItems[focusedIndex];
            if (activeItem) {
                chooseItem(activeItem);
            }
        } else {
            shouldPreventDefault = false;
        }

        if (shouldPreventDefault) {
            e.preventDefault();
        }

        if (nextIndex !== focusedIndex && nextIndex >= 0) {
            setFocusedIndex(nextIndex);
            virtuosoRef.current?.scrollToIndex({
                index: nextIndex,
                align: 'center',
                behavior: 'smooth'
            });
        }
    }, [focusedIndex, filteredItems, chooseItem, handleClose]);

    const renderList = () => {
        if (filteredItems.length === 0) {
            return <div className="v-action-panel-empty">No matching options.</div>;
        }

        if (isDrawer) {
            return (
                <Virtuoso
                    ref={virtuosoRef}
                    className="v-virtuoso-container"
                    data={filteredItems}
                    fixedItemHeight={ITEM_HEIGHT}
                    itemContent={(index, item) => (
                        <ItemComponent
                            item={item}
                            isFocused={index === focusedIndex}
                            isDrawer={isDrawer}
                            contextActions={contextActions ? contextActions(item) : undefined}
                            onChoose={() => chooseItem(item)}
                            onFocus={() => setFocusedIndex(index)}
                            onContextAction={(actionId) => handleContextAction(actionId, item.data)}
                        />
                    )}
                />
            );
        }

        return filteredItems.map((item, index) => (
            <ItemComponent
                key={item.id}
                item={item}
                isFocused={index === focusedIndex}
                isDrawer={isDrawer}
                contextActions={contextActions ? contextActions(item) : undefined}
                onChoose={() => chooseItem(item)}
                onFocus={() => setFocusedIndex(index)}
                onContextAction={(actionId) => handleContextAction(actionId, item.data)}
            />
        ));
    };

    return (
        <div 
            className={clsx("v-panel-container is-active", {
                'is-modal-like': !isDrawer,
                'is-drawer-like': isDrawer,
            })} 
            onClick={handleBackdropClick}
        >
            <div 
                className={clsx("v-inline-panel v-action-panel", { 'is-drawer': isDrawer })} 
                onKeyDown={handleKeyDown}
            >
                <div className="v-panel-header">
                    <h3>{panelState.title}</h3>
                    {!isDrawer && (
                        <button className="clickable-icon v-panel-close" aria-label="Close" onClick={handleClose}>
                            <Icon name="x" />
                        </button>
                    )}
                </div>
                {panelState.showFilter && (
                    <div className="v-action-panel-filter">
                        <input ref={filterInputRef} type="text" placeholder="Filter or create..." onChange={e => debouncedSetFilter(e.target.value)} />
                    </div>
                )}
                <div className="v-action-panel-list">
                    {renderList()}
                </div>
            </div>
        </div>
    );
};
