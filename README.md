# OrthoflowFront

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.10.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Booking, Emergency & WhatsApp Status UI

- `/book` (`PublicBookingComponent`): Mobile-first direct booking flow with E.164 country selector + phone normalization, live doctor availability slots, optional Cloudflare Turnstile widget (`BOOKING_CAPTCHA_*`), privacy-aware registration CTA (`registrationUrl` shown only for newly created incomplete patients), and multilingual i18n (`fr`, `ar`, `en`).
- Emergency bypass (`EmergencyButtonComponent`): Sticky red `"Contact us immediately"` trigger mounted across public pages (`/book`, `/public/*`, `/landing`, `/login`, password reset) opening `tel:` (primary on mobile) and prefilled `https://wa.me/<digits>?text=URGENT...` actions from `/api/v1/public/config`.
- Clinician dashboard flags:
  - `MainLayoutComponent` + `WhatsappInboxComponent` listen on live SSE events (`whatsapp-urgent`, `whatsapp-inbox`) and raise a prominent red banner when inbound `URGENT` messages arrive.
  - `ScheduleComponent` and `FrontDeskComponent` visually flag `LATE` (`2`) and `CANCELLED` (`3`) reminder replies with `replyStatus` labels.

## OpenAPI Types & Production Build

Keep generated API types synced with the Spring Boot OpenAPI schema before committing:

```bash
npm run generate:api-types
npx ng test --watch=false
npx ng build --configuration production
```

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
