'use client';

import { Slider as BaseSlider } from '@base-ui-components/react/slider';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from 'react';

import { cn } from '@/lib/cn';

const Slider = BaseSlider.Root;
const SliderValue = BaseSlider.Value;

const SliderControl = forwardRef<
  ElementRef<typeof BaseSlider.Control>,
  ComponentPropsWithoutRef<typeof BaseSlider.Control>
>(({ className, children, ...props }, ref) => (
  <BaseSlider.Control
    ref={ref}
    className={cn('flex w-full touch-none select-none items-center py-2', className)}
    {...props}
  >
    <BaseSlider.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/[0.08]">
      <BaseSlider.Indicator className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--accent-2)_0%,var(--accent)_100%)] shadow-[0_0_12px_var(--glow)]" />
    </BaseSlider.Track>
    {children}
  </BaseSlider.Control>
));
SliderControl.displayName = 'SliderControl';

const SliderThumb = forwardRef<
  ElementRef<typeof BaseSlider.Thumb>,
  ComponentPropsWithoutRef<typeof BaseSlider.Thumb>
>(({ className, ...props }, ref) => (
  <BaseSlider.Thumb
    ref={ref}
    className={cn(
      'relative block size-4 rounded-full border border-white/40 bg-[var(--text)] shadow-[0_0_12px_var(--glow)] outline-none transition-transform duration-150',
      'hover:scale-110 focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--glow)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
      'data-[dragging]:scale-110 data-[dragging]:ring-2 data-[dragging]:ring-[var(--glow)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  />
));
SliderThumb.displayName = 'SliderThumb';

export { Slider, SliderValue, SliderControl, SliderThumb };
