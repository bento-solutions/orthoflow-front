import { Component, Input } from '@angular/core';

export type IconName =
  // navigation
  | 'grid' | 'users' | 'calendar' | 'activity' | 'receipt' | 'box' | 'chart' | 'settings'
  // actions
  | 'plus' | 'search' | 'close' | 'edit' | 'trash' | 'filter' | 'print' | 'download'
  | 'send' | 'save' | 'refresh' | 'external' | 'more'
  // state
  | 'check' | 'check-circle' | 'alert-triangle' | 'alert-circle' | 'info' | 'clock'
  // direction
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'chevron-up' | 'chevrons-left' | 'arrow-right'
  // domain
  | 'tooth' | 'stethoscope' | 'file-text' | 'credit-card' | 'trending-up' | 'user-plus'
  | 'menu' | 'log-out' | 'mic' | 'inbox'
  // added with the practice-management screens
  | 'moon' | 'sun' | 'bell' | 'help-circle' | 'qr-code' | 'shield' | 'wallet' | 'clipboard' | 'message'
  | 'flask' | 'percent' | 'user' | 'lock' | 'link' | 'phone' | 'camera' | 'sparkle' | 'copy' | 'list'
  | 'x-circle' | 'eye' | 'arrow-left' | 'upload';

/* One icon set, one stroke weight, one optical size.
 *
 * The product previously ran two icon systems side by side — inline
 * Feather-style SVG in the shell, dashboard, stock and treatments; Material
 * Icons ligatures in patients, billing, schedule and the 3D canvas — with
 * different stroke weights and metrics touching each other on the same
 * screen. This component is the replacement.
 *
 * Icons are drawn on a 24px grid at 1.75 stroke, which holds up at the
 * 16–20px sizes the UI actually renders them at. `strokeWidth` is exposed
 * because a 14px icon needs a slightly heavier stroke to stay visible.
 *
 * Decorative by default (`aria-hidden`). Pass a `label` only when the icon
 * is the sole carrier of meaning — an icon inside a button that already has
 * an accessible name must stay hidden, or a screen reader announces it
 * twice.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      [attr.width]="size"
      [attr.height]="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.aria-hidden]="label ? null : 'true'"
      [attr.role]="label ? 'img' : null"
      [attr.aria-label]="label || null"
      class="shrink-0"
    >
      @switch (name) {
        @case ('grid') {
          <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" />
        }
        @case ('users') {
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        }
        @case ('calendar') {
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        }
        @case ('activity') { <path d="M22 12h-4l-3 9L9 3l-3 9H2" /> }
        @case ('receipt') {
          <path d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5z" />
          <path d="M8 8h7M8 12h5" />
        }
        @case ('box') {
          <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z" />
          <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
        }
        @case ('chart') { <path d="M18 20V10M12 20V4M6 20v-6" /> }
        @case ('settings') {
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        }

        @case ('plus') { <path d="M12 5v14M5 12h14" /> }
        @case ('search') { <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /> }
        @case ('close') { <path d="M18 6 6 18M6 6l12 12" /> }
        @case ('edit') { <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /><path d="m15 5 4 4" /> }
        @case ('trash') { <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /> }
        @case ('filter') { <path d="M3 5h18M6 12h12M10 19h4" /> }
        @case ('print') { <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /> }
        @case ('download') { <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /> }
        @case ('send') { <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /> }
        @case ('save') { <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /> }
        @case ('refresh') { <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /> }
        @case ('external') { <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" /> }
        @case ('more') { <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /> }

        @case ('check') { <path d="m20 6-11 11-5-5" /> }
        @case ('check-circle') { <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /> }
        @case ('alert-triangle') { <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><circle cx="12" cy="17" r=".5" fill="currentColor" /> }
        @case ('alert-circle') { <circle cx="12" cy="12" r="9" /><path d="M12 7v5" /><circle cx="12" cy="16" r=".5" fill="currentColor" /> }
        @case ('info') { <circle cx="12" cy="12" r="9" /><path d="M12 16v-5" /><circle cx="12" cy="8" r=".5" fill="currentColor" /> }
        @case ('clock') { <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /> }

        @case ('chevron-left') { <path d="m15 18-6-6 6-6" /> }
        @case ('chevron-right') { <path d="m9 18 6-6-6-6" /> }
        @case ('chevron-down') { <path d="m6 9 6 6 6-6" /> }
        @case ('chevron-up') { <path d="m18 15-6-6-6 6" /> }
        @case ('chevrons-left') { <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" /> }
        @case ('arrow-right') { <path d="M5 12h14M13 6l6 6-6 6" /> }

        @case ('tooth') { <path d="M12 5.5c1.6-1.4 3-2 4.4-2C19 3.5 21 5.6 21 8.8c0 2.2-.7 3.6-1.3 6-.5 1.9-.6 5.7-2.4 5.7-1.6 0-1.7-2.6-2.2-4.6-.4-1.5-.8-2.4-3.1-2.4s-2.7.9-3.1 2.4c-.5 2-.6 4.6-2.2 4.6-1.8 0-1.9-3.8-2.4-5.7C3.7 12.4 3 11 3 8.8 3 5.6 5 3.5 7.6 3.5c1.4 0 2.8.6 4.4 2z" /> }
        @case ('stethoscope') { <path d="M5 3v6a4 4 0 0 0 8 0V3M5 3H3.5M13 3h1.5M9 13v2a5 5 0 0 0 10 0v-1" /><circle cx="19" cy="12" r="2" /> }
        @case ('file-text') { <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" /><path d="M14 2v5h5M9 13h6M9 17h4" /> }
        @case ('credit-card') { <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h3" /> }
        @case ('trending-up') { <path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /> }
        @case ('user-plus') { <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /> }
        @case ('menu') { <path d="M3 6h18M3 12h18M3 18h18" /> }
        @case ('log-out') { <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /> }
        @case ('mic') { <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /> }
        @case ('inbox') { <path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z" /> }
        @case ('moon') { <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /> }
        @case ('sun') {
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        }
        @case ('bell') { <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" /> }
        @case ('help-circle') { <circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><circle cx="12" cy="17" r=".5" fill="currentColor" /> }
        @case ('qr-code') {
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4" />
        }
        @case ('shield') { <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> }
        @case ('wallet') {
          <path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h12v4" /><path d="M3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
        }
        @case ('clipboard') {
          <rect x="8" y="2" width="8" height="4" rx="1" />
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4" />
        }
        @case ('message') { <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> }
        @case ('flask') { <path d="M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3" /><path d="M7.5 14h9" /> }
        @case ('percent') { <path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /> }
        @case ('user') { <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /> }
        @case ('lock') { <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /> }
        @case ('link') {
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        }
        @case ('phone') {
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        }
        @case ('camera') { <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /> }
        @case ('sparkle') { <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 3v4M17 5h4" /> }
        @case ('copy') { <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /> }
        @case ('list') { <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> }
        @case ('x-circle') { <circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /> }
        @case ('eye') { <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /> }
        @case ('arrow-left') { <path d="M19 12H5M11 18l-6-6 6-6" /> }
        @case ('upload') { <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /> }
      }
    </svg>
  `,
  styles: [':host { display: inline-flex; }'],
})
export class IconComponent {
  @Input({ required: true }) name!: IconName;
  @Input() size: number | string = 18;
  @Input() strokeWidth: number | string = 1.75;
  /** Set only when the icon carries meaning no adjacent text provides. */
  @Input() label = '';
}
