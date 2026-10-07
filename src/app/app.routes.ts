import { Routes } from '@angular/router';
import { financeHomeGuard } from './features/finance/finance-tabs';
import { analyticsHomeGuard } from './features/analytics/analytics-tabs';
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
    // Pages a patient opens from a link: no sign-in, no staff navigation. The token in the address is the only authority.
    path: 'public',
    children: [
      { path: 'book/:token', loadComponent: () => import('./features/public/public-booking.component').then(m => m.PublicBookingComponent) },
      { path: 'register/:token', loadComponent: () => import('./features/public/public-registration.component').then(m => m.PublicRegistrationComponent) },
      { path: 'survey/:token', loadComponent: () => import('./features/public/public-survey.component').then(m => m.PublicSurveyComponent) },
    ],
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
            // Before ':id', which would otherwise take "duplicates" for a patient.
            path: 'duplicates',
            canActivate: [permissionGuard('PATIENT_MERGE')],
            loadComponent: () => import('./features/patients/duplicates/patient-duplicates.component').then(m => m.PatientDuplicatesComponent),
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
        path: 'recalls',
        canActivate: [permissionGuard('AGENDA_VIEW')],
        loadComponent: () => import('./features/patients/recalls/recalls.component').then(m => m.RecallsComponent),
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
            path: 'agenda',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/agenda-settings.component').then(m => m.AgendaSettingsComponent),
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
        path: 'lab-orders',
        canActivate: [permissionGuard('LAB_ORDERS_MANAGE')],
        loadComponent: () => import('./features/lab/lab-orders.component').then(m => m.LabOrdersComponent),
      },
      {
        path: 'tasks',
        canActivate: [permissionGuard('TASKS_MANAGE')],
        loadComponent: () => import('./features/tasks/tasks.component').then(m => m.TasksComponent),
      },
      {
        path: 'messages',
        loadComponent: () => import('./features/messages/messages.component').then(m => m.MessagesComponent),
      },
      {
        path: 'communication',
        canActivate: [permissionGuard('MESSAGING_VIEW')],
        loadComponent: () => import('./features/communication/communication-layout.component').then(m => m.CommunicationLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'logs' },
          { path: 'logs', loadComponent: () => import('./features/communication/message-logs.component').then(m => m.MessageLogsComponent) },
          { path: 'inbox', loadComponent: () => import('./features/communication/whatsapp-inbox.component').then(m => m.WhatsappInboxComponent) },
          { path: 'templates', loadComponent: () => import('./features/communication/templates.component').then(m => m.TemplatesComponent) },
          { path: 'settings', loadComponent: () => import('./features/communication/messaging-settings.component').then(m => m.MessagingSettingsComponent) },
        ],
      },
      {
        path: 'booking',
        canActivate: [permissionGuard('BOOKING_REVIEW')],
        loadComponent: () => import('./features/intake/intake-layout.component').then(m => m.IntakeLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'requests' },
          { path: 'requests', loadComponent: () => import('./features/intake/booking-requests.component').then(m => m.BookingRequestsComponent) },
          { path: 'registrations', loadComponent: () => import('./features/intake/registrations.component').then(m => m.RegistrationsComponent) },
        ],
      },
      {
        path: 'surveys',
        canActivate: [permissionGuard('SURVEYS_VIEW')],
        loadComponent: () => import('./features/intake/surveys.component').then(m => m.SurveysComponent),
      },
      {
        path: 'retrocessions',
        canActivate: [permissionGuard('RETROCESSION_VIEW')],
        loadComponent: () => import('./features/retrocessions/retrocessions-layout.component').then(m => m.RetrocessionsLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'simulation' },
          { path: 'simulation', loadComponent: () => import('./features/retrocessions/retro-simulation.component').then(m => m.RetroSimulationComponent) },
          { path: 'statements', loadComponent: () => import('./features/retrocessions/retro-statements.component').then(m => m.RetroStatementsComponent) },
          { path: 'rules', loadComponent: () => import('./features/retrocessions/retro-rules.component').then(m => m.RetroRulesComponent) },
          { path: 'advances', loadComponent: () => import('./features/retrocessions/retro-advances.component').then(m => m.RetroAdvancesComponent) },
        ],
      },
      {
        path: 'analytics',
        canActivate: [permissionGuard('ANALYTICS_VIEW', 'FINANCE_VIEW')],
        loadComponent: () => import('./features/analytics/analytics-layout.component').then(m => m.AnalyticsLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', canActivate: [analyticsHomeGuard], children: [] },
          { path: 'procedures', canActivate: [permissionGuard('ANALYTICS_VIEW')], loadComponent: () => import('./features/analytics/procedures.component').then(m => m.ProceduresComponent) },
          { path: 'time', canActivate: [permissionGuard('ANALYTICS_VIEW')], loadComponent: () => import('./features/analytics/doctor-time.component').then(m => m.DoctorTimeComponent) },
          { path: 'income', canActivate: [permissionGuard('FINANCE_VIEW')], loadComponent: () => import('./features/analytics/income-statement.component').then(m => m.IncomeStatementComponent) },
          { path: 'goals', canActivate: [permissionGuard('FINANCE_VIEW')], loadComponent: () => import('./features/analytics/goals.component').then(m => m.GoalsComponent) },
          { path: 'tax', canActivate: [permissionGuard('FINANCE_VIEW')], loadComponent: () => import('./features/analytics/tax-simulation.component').then(m => m.TaxSimulationComponent) },
        ],
      },
      {
        path: 'sterilization',
        canActivate: [permissionGuard('STERILIZATION_MANAGE')],
        loadComponent: () => import('./features/sterilization/sterilization-layout.component').then(m => m.SterilizationLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
          { path: 'dashboard', loadComponent: () => import('./features/sterilization/sterilization-dashboard.component').then(m => m.SterilizationDashboardComponent) },
          { path: 'scan', loadComponent: () => import('./features/sterilization/scan.component').then(m => m.ScanComponent) },
          { path: 'items', loadComponent: () => import('./features/sterilization/sterilization-items.component').then(m => m.SterilizationItemsComponent) },
          { path: 'cycles', loadComponent: () => import('./features/sterilization/sterilization-cycles.component').then(m => m.SterilizationCyclesComponent) },
          { path: 'trace', loadComponent: () => import('./features/sterilization/sterilization-trace.component').then(m => m.SterilizationTraceComponent) },
          { path: 'endo', loadComponent: () => import('./features/sterilization/sterilization-endo.component').then(m => m.SterilizationEndoComponent) },
        ],
      },
      {
        path: 'finance',
        canActivate: [permissionGuard('FINANCE_VIEW', 'BILLING_READ')],
        loadComponent: () => import('./features/finance/finance-layout.component').then(m => m.FinanceLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', canActivate: [financeHomeGuard], children: [] },
          {
            path: 'dashboard',
            canActivate: [permissionGuard('FINANCE_VIEW')],
            loadComponent: () => import('./features/finance/pages/finance-dashboard.component').then(m => m.FinanceDashboardComponent),
          },
          {
            path: 'collections',
            canActivate: [permissionGuard('FINANCE_VIEW')],
            loadComponent: () => import('./features/finance/pages/collections.component').then(m => m.CollectionsComponent),
          },
          {
            path: 'cash',
            canActivate: [permissionGuard('FINANCE_VIEW')],
            loadComponent: () => import('./features/finance/pages/cash-closing.component').then(m => m.CashClosingComponent),
          },
          {
            path: 'debts',
            canActivate: [permissionGuard('BILLING_READ')],
            loadComponent: () => import('./features/finance/pages/debts.component').then(m => m.DebtsComponent),
          },
          {
            path: 'instalments',
            canActivate: [permissionGuard('BILLING_READ')],
            loadComponent: () => import('./features/finance/pages/instalments.component').then(m => m.InstalmentsComponent),
          },
          {
            path: 'cheques',
            canActivate: [permissionGuard('BILLING_READ')],
            loadComponent: () => import('./features/finance/pages/cheques.component').then(m => m.ChequesComponent),
          },
          {
            path: 'expenses',
            canActivate: [permissionGuard('FINANCE_VIEW')],
            loadComponent: () => import('./features/finance/pages/expenses.component').then(m => m.ExpensesComponent),
          },
          {
            path: 'tax-documents',
            canActivate: [permissionGuard('BILLING_READ')],
            loadComponent: () => import('./features/finance/pages/tax-documents.component').then(m => m.TaxDocumentsComponent),
          },
        ],
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
