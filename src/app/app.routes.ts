import { Routes } from '@angular/router';
import { onboardingGuard } from './core/guards/onboarding.guard';
import { authGuard } from './core/guards/auth.guard';
import { permissionGuard } from './core/guards/permission.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login-page.component').then(m => m.LoginPageComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./features/auth/forgot-password-page.component').then(m => m.ForgotPasswordPageComponent),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./features/auth/reset-password-page.component').then(m => m.ResetPasswordPageComponent),
  },
  {
    path: 'landing',
    loadComponent: () => import('./features/landing/landing.component').then(m => m.LandingPageComponent),
  },
  {
    path: 'onboarding',
    loadComponent: () => import('./features/onboarding/onboarding.component').then(m => m.OnboardingComponent),
    canActivate: [onboardingGuard]
  },
  {
    path: '',
    loadComponent: () => import('./layout/main-layout/main-layout.component').then(m => m.MainLayoutComponent),
    // onboardingGuard must run before authGuard: a fresh install has no user
    // account yet, so checking auth first sent every unauthenticated visitor
    // straight to /login with no path to onboarding — and onboarding is the
    // only place that can create the first account. Once onboarded, this
    // guard passes through to authGuard as before.
    canActivate: [onboardingGuard, authGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
      {
        path: 'patients',
        children: [
          {
            path: '',
            loadComponent: () => import('./features/patients/patient-list/patient-list.component').then(m => m.PatientListComponent),
          },
          {
            path: 'register',
            loadComponent: () => import('./features/patients/patient-registration/patient-registration.component').then(m => m.PatientRegistrationComponent),
          },
          {
            path: ':id',
            loadComponent: () => import('./features/patients/patient-dossier/patient-dossier.component').then(m => m.PatientDossierComponent),
          },
          {
            path: ':id/edit',
            loadComponent: () => import('./features/patients/patient-registration/patient-registration.component').then(m => m.PatientRegistrationComponent),
          },
          {
            // Where a dictated examination is corrected and committed. A route
            // rather than a modal because this *is* the write step: it has to
            // survive a refresh, and a stray backdrop click must not be able
            // to discard a consultation.
            path: ':id/session/:sessionId/review',
            loadComponent: () => import('./features/patients/session-review/session-review.component').then(m => m.SessionReviewComponent),
          }
        ]
      },
      {
        path: 'front-desk',
        canActivate: [permissionGuard('AGENDA_VIEW', 'WAITING_ROOM_MANAGE')],
        loadComponent: () => import('./features/front-desk/front-desk.component').then(m => m.FrontDeskComponent),
      },
      {
        path: 'schedule',
        loadComponent: () => import('./features/schedule/schedule.component').then(m => m.ScheduleComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings-layout.component').then(m => m.SettingsLayoutComponent),
        canActivate: [permissionGuard('SETTINGS_MANAGE', 'USERS_MANAGE')],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'practice' },
          {
            path: 'practice',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/practice-profile.component').then(m => m.PracticeProfileComponent),
          },
          {
            path: 'hours',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/opening-hours.component').then(m => m.OpeningHoursComponent),
          },
          {
            path: 'team',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/team-settings.component').then(m => m.TeamSettingsComponent),
          },
          {
            path: 'users',
            canActivate: [permissionGuard('USERS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/users-settings.component').then(m => m.UsersSettingsComponent),
          },
          {
            path: 'booking',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/booking-settings.component').then(m => m.BookingSettingsComponent),
          },
          {
            path: 'help-notes',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/help-notes-settings.component').then(m => m.HelpNotesSettingsComponent),
          },
        ],
      },
      {
        path: 'account',
        loadComponent: () => import('./features/settings/pages/account.component').then(m => m.AccountComponent),
      },
      {
        path: 'billing',
        loadChildren: () => import('./features/billing/billing.routes').then(m => m.BILLING_ROUTES),
      },
      {
        path: 'stock',
        children: [
          {
            path: '',
            loadComponent: () => import('./features/stock/pages/stock-dashboard/stock-dashboard.component').then(m => m.StockDashboardComponent),
          },
          {
            path: 'procurement',
            loadComponent: () => import('./features/stock/pages/purchase-orders/purchase-orders.component').then(m => m.PurchaseOrdersComponent),
          },
          {
            path: 'direct-sales',
            loadComponent: () => import('./features/stock/pages/sales-orders/sales-orders.component').then(m => m.SalesOrdersComponent),
          },
          {
            path: 'treatment-sessions',
            loadComponent: () => import('./features/stock/pages/treatment-sessions/treatment-sessions.component').then(m => m.TreatmentSessionsComponent),
          },
        ]
      },
      {
        path: 'treatments',
        loadComponent: () => import('./features/treatments/pages/treatments-list/treatments-list.component').then(m => m.TreatmentsListComponent),
      },
    ]
  },
  {
    path: '**',
    redirectTo: '',
  },
];
