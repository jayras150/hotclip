'use client';

import { Tabs as BaseTabs } from '@base-ui-components/react/tabs';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from '@/lib/cn';

const Tabs = BaseTabs.Root;

const TabsList = forwardRef<
  ElementRef<typeof BaseTabs.List>,
  ComponentPropsWithoutRef<typeof BaseTabs.List>
>(({ className, ...props }, ref) => (
  <BaseTabs.List
    ref={ref}
    className={cn(
      'relative inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-2)]/70 p-1 backdrop-blur-xl',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

/** Sliding pill: animates via transform using Base UI indicator position. */
const TabsIndicator = forwardRef<
  ElementRef<typeof BaseTabs.Indicator>,
  ComponentPropsWithoutRef<typeof BaseTabs.Indicator>
>(({ className, ...props }, ref) => (
  <BaseTabs.Indicator
    ref={ref}
    className={cn(
      'absolute left-0 top-0 -z-0 h-[var(--active-tab-height)] w-[var(--active-tab-width)] rounded-[var(--radius-md)] bg-[linear-gradient(100deg,var(--accent)_0%,var(--accent-2)_100%)] shadow-[0_0_18px_var(--glow)] transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
      className,
    )}
    {...props}
  />
));
TabsIndicator.displayName = 'TabsIndicator';

const TabsTab = forwardRef<
  ElementRef<typeof BaseTabs.Tab>,
  ComponentPropsWithoutRef<typeof BaseTabs.Tab>
>(({ className, ...props }, ref) => (
  <BaseTabs.Tab
    ref={ref}
    className={cn(
      'relative z-10 inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] transition-colors duration-200 hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)] disabled:pointer-events-none disabled:opacity-50',
      'data-[active]:font-semibold data-[active]:text-[#04121a]',
      className,
    )}
    {...props}
  />
));
TabsTab.displayName = 'TabsTab';

const TabsPanel = forwardRef<
  ElementRef<typeof BaseTabs.Panel>,
  ComponentPropsWithoutRef<typeof BaseTabs.Panel>
>(({ className, ...props }, ref) => (
  <BaseTabs.Panel
    ref={ref}
    className={cn('mt-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--glow)]', className)}
    {...props}
  />
));
TabsPanel.displayName = 'TabsPanel';

export { Tabs, TabsList, TabsIndicator, TabsTab, TabsPanel };
