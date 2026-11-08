import { Routes } from '@angular/router';
import { financeHomeGuard } from './features/finance/finance-tabs';
import { analyticsHomeGuard } from './features/analytics/analytics-tabs';
import { onboardingGuard } from './core/guards/onboarding.guard';
import { authGuard } from './core/guards/auth.guard';
import { permissionGuard } from './core/guards/permission.guard';

export const routes: Routes = [
  {
    path: 'login',
    title: 'AUTH.SIGN_IN_BUTTON',
    loadComponent: () => import('./features/auth/login-page.component').then(m => m.LoginPageComponent),
  },
  {
    path: 'forgot-password',
    title: 'AUTH.FORGOT_TITLE',
    loadComponent: () => import('./features/auth/forgot-password-page.component').then(m => m.ForgotPasswordPageComponent),
  },
  {
    path: 'reset-password',
    title: 'AUTH.RESET_TITLE',
    loadComponent: () => import('./features/auth/reset-password-page.component').then(m => m.ResetPasswordPageComponent),
  },
  {
    path: 'landing',
    title: 'LANDING.FUTURE_PRACTICE',
    loadComponent: () => import('./features/landing/landing.component').then(m => m.LandingPageComponent),
  },
  {
    path: 'onboarding',
    title: 'ONBOARDING.WELCOME_TITLE',
    loadComponent: () => import('./features/onboarding/onboarding.component').then(m => m.OnboardingComponent),
    canActivate: [onboardingGuard]
  },
  {
    // Pages a patient opens from a link: no sign-in, no staff navigation. The token in the address is the only authority.
    path: 'public',
    children: [
      { path: 'book/:token', title: 'PUB.BOOK.TITLE', loadComponent: () => import('./features/public/public-booking.component').then(m => m.PublicBookingComponent) },
      { path: 'register/:token', title: 'PUB.REG.TITLE', loadComponent: () => import('./features/public/public-registration.component').then(m => m.PublicRegistrationComponent) },
      { path: 'survey/:token', title: 'PUB.SURVEY.TITLE', loadComponent: () => import('./features/public/public-survey.component').then(m => m.PublicSurveyComponent) },
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
        title: 'COMMON.OVERVIEW',
        loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
      },
      {
        path: 'patients',
        title: 'PATIENTS.TITLE',
        children: [
          {
            path: '',
            loadComponent: () => import('./features/patients/patient-list/patient-list.component').then(m => m.PatientListComponent),
          },
          {
            path: 'register',
            title: 'PATIENTS.DOSSIER.REGISTRATION_TITLE',
            loadComponent: () => import('./features/patients/patient-registration/patient-registration.component').then(m => m.PatientRegistrationComponent),
          },
          {
            // Before ':id', which would otherwise take "duplicates" for a patient.
            path: 'duplicates',
            title: 'PAT.DUP.TITLE',
            canActivate: [permissionGuard('PATIENT_MERGE')],
            loadComponent: () => import('./features/patients/duplicates/patient-duplicates.component').then(m => m.PatientDuplicatesComponent),
          },
          {
            path: ':id',
            title: 'PATIENTS.DOSSIER.TITLE',
            loadComponent: () => import('./features/patients/patient-dossier/patient-dossier.component').then(m => m.PatientDossierComponent),
          },
          {
            path: ':id/edit',
            title: 'PATIENTS.DOSSIER.EDIT_DOSSIER',
            loadComponent: () => import('./features/patients/patient-registration/patient-registration.component').then(m => m.PatientRegistrationComponent),
          },
          {
            // Where a dictated examination is corrected and committed. A route
            // rather than a modal because this *is* the write step: it has to
            // survive a refresh, and a stray backdrop click must not be able
            // to discard a consultation.
            path: ':id/session/:sessionId/review',
            title: 'VOICE.REVIEW_TITLE',
            loadComponent: () => import('./features/patients/session-review/session-review.component').then(m => m.SessionReviewComponent),
          }
        ]
      },
      {
        path: 'recalls',
        title: 'REC.TITLE',
        canActivate: [permissionGuard('AGENDA_VIEW')],
        loadComponent: () => import('./features/patients/recalls/recalls.component').then(m => m.RecallsComponent),
      },
      {
        path: 'front-desk',
        title: 'FD.TITLE',
        canActivate: [permissionGuard('AGENDA_VIEW', 'WAITING_ROOM_MANAGE')],
        loadComponent: () => import('./features/front-desk/front-desk.component').then(m => m.FrontDeskComponent),
      },
      {
        path: 'schedule',
        title: 'SCHEDULE.TITLE',
        loadComponent: () => import('./features/schedule/schedule.component').then(m => m.ScheduleComponent),
      },
      {
        path: 'settings',
        title: 'COMMON.SETTINGS',
        loadComponent: () => import('./features/settings/settings-layout.component').then(m => m.SettingsLayoutComponent),
        canActivate: [permissionGuard('SETTINGS_MANAGE', 'USERS_MANAGE')],
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'practice' },
          {
            path: 'practice',
            title: 'SET.TABS.PRACTICE',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/practice-profile.component').then(m => m.PracticeProfileComponent),
          },
          {
            path: 'hours',
            title: 'SET.TABS.HOURS',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/opening-hours.component').then(m => m.OpeningHoursComponent),
          },
          {
            path: 'team',
            title: 'SET.TABS.TEAM',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/team-settings.component').then(m => m.TeamSettingsComponent),
          },
          {
            path: 'users',
            title: 'SET.TABS.USERS',
            canActivate: [permissionGuard('USERS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/users-settings.component').then(m => m.UsersSettingsComponent),
          },
          {
            path: 'agenda',
            title: 'SET.TABS.AGENDA',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/agenda-settings.component').then(m => m.AgendaSettingsComponent),
          },
          {
            path: 'booking',
            title: 'SET.TABS.BOOKING',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/booking-settings.component').then(m => m.BookingSettingsComponent),
          },
          {
            path: 'help-notes',
            title: 'SET.TABS.HELP',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/help-notes-settings.component').then(m => m.HelpNotesSettingsComponent),
          },
          {
            path: 'insurers',
            title: 'SET.TABS.INSURERS',
            canActivate: [permissionGuard('SETTINGS_MANAGE')],
            loadComponent: () => import('./features/settings/pages/insurers-settings.component').then(m => m.InsurersSettingsComponent),
          },
        ],
      },
      {
        path: 'insurance-forms',
        title: 'INSURANCE.PAGE_TITLE',
        canActivate: [permissionGuard('BILLING_READ')],
        loadComponent: () => import('./features/insurance/insurance-forms.component').then(m => m.InsuranceFormsComponent),
      },
      {
        path: 'prescription-templates',
        title: 'RX.TEMPLATES_TITLE',
        canActivate: [permissionGuard('CLINICAL_WRITE')],
        loadComponent: () => import('./features/prescriptions/prescription-templates.component').then(m => m.PrescriptionTemplatesComponent),
      },
      {
        path: 'account',
        title: 'NAV.ACCOUNT',
        loadComponent: () => import('./features/settings/pages/account.component').then(m => m.AccountComponent),
      },
      {
        path: 'lab-orders',
        title: 'LAB.TITLE',
        canActivate: [permissionGuard('LAB_ORDERS_MANAGE')],
        loadComponent: () => import('./features/lab/lab-orders.component').then(m => m.LabOrdersComponent),
      },
      {
        path: 'tasks',
        title: 'TASK.TITLE',
        canActivate: [permissionGuard('TASKS_MANAGE')],
        loadComponent: () => import('./features/tasks/tasks.component').then(m => m.TasksComponent),
      },
      {
        path: 'messages',
        title: 'MSG.TITLE',
        loadComponent: () => import('./features/messages/messages.component').then(m => m.MessagesComponent),
      },
      {
        path: 'communication',
        title: 'NAV.COMMUNICATION',
        canActivate: [permissionGuard('MESSAGING_VIEW')],
        loadComponent: () => import('./features/communication/communication-layout.component').then(m => m.CommunicationLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'logs' },
          { path: 'logs', title: 'COM.TABS.LOGS', loadComponent: () => import('./features/communication/message-logs.component').then(m => m.MessageLogsComponent) },
          { path: 'inbox', title: 'COM.TABS.INBOX', loadComponent: () => import('./features/communication/whatsapp-inbox.component').then(m => m.WhatsappInboxComponent) },
          { path: 'templates', title: 'COM.TABS.TEMPLATES', loadComponent: () => import('./features/communication/templates.component').then(m => m.TemplatesComponent) },
          { path: 'settings', title: 'COM.TABS.SETTINGS', loadComponent: () => import('./features/communication/messaging-settings.component').then(m => m.MessagingSettingsComponent) },
        ],
      },
      {
        path: 'booking',
        title: 'NAV.BOOKING',
        canActivate: [permissionGuard('BOOKING_REVIEW')],
        loadComponent: () => import('./features/intake/intake-layout.component').then(m => m.IntakeLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'requests' },
          { path: 'requests', title: 'INT.TABS.REQUESTS', loadComponent: () => import('./features/intake/booking-requests.component').then(m => m.BookingRequestsComponent) },
          { path: 'registrations', title: 'INT.TABS.REGISTRATIONS', loadComponent: () => import('./features/intake/registrations.component').then(m => m.RegistrationsComponent) },
        ],
      },
      {
        path: 'surveys',
        title: 'NAV.SURVEYS',
        canActivate: [permissionGuard('SURVEYS_VIEW')],
        loadComponent: () => import('./features/intake/surveys.component').then(m => m.SurveysComponent),
      },
      {
        path: 'retrocessions',
        title: 'NAV.RETROCESSIONS',
        canActivate: [permissionGuard('RETROCESSION_VIEW')],
        loadComponent: () => import('./features/retrocessions/retrocessions-layout.component').then(m => m.RetrocessionsLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'simulation' },
          { path: 'simulation', title: 'RETRO.TABS.SIMULATION', loadComponent: () => import('./features/retrocessions/retro-simulation.component').then(m => m.RetroSimulationComponent) },
          { path: 'statements', title: 'RETRO.TABS.STATEMENTS', loadComponent: () => import('./features/retrocessions/retro-statements.component').then(m => m.RetroStatementsComponent) },
          { path: 'rules', title: 'RETRO.TABS.RULES', loadComponent: () => import('./features/retrocessions/retro-rules.component').then(m => m.RetroRulesComponent) },
          { path: 'advances', title: 'RETRO.TABS.ADVANCES', loadComponent: () => import('./features/retrocessions/retro-advances.component').then(m => m.RetroAdvancesComponent) },
        ],
      },
      {
        path: 'analytics',
        title: 'COMMON.ANALYTICS',
        canActivate: [permissionGuard('ANALYTICS_VIEW', 'FINANCE_VIEW')],
        loadComponent: () => import('./features/analytics/analytics-layout.component').then(m => m.AnalyticsLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', canActivate: [analyticsHomeGuard], children: [] },
          { path: 'procedures', title: 'ANA.TABS.PROCEDURES', canActivate: [permissionGuard('ANALYTICS_VIEW')], loadComponent: () => import('./features/analytics/procedures.component').then(m => m.ProceduresComponent) },
          { path: 'time', title: 'ANA.TABS.TIME', canActivate: [permissionGuard('ANALYTICS_VIEW')], loadComponent: () => import('./features/analytics/doctor-time.component').then(m => m.DoctorTimeComponent) },
          { path: 'income', title: 'ANA.TABS.INCOME', canActivate: [permissionGuard('FINANCE_VIEW')], loadComponent: () => import('./features/analytics/income-statement.component').then(m => m.IncomeStatementComponent) },
          { path: 'goals', title: 'ANA.TABS.GOALS', canActivate: [permissionGuard('FINANCE_VIEW')], loadComponent: () => import('./features/analytics/goals.component').then(m => m.GoalsComponent) },
          { path: 'tax', title: 'ANA.TABS.TAX', canActivate: [permissionGuard('FINANCE_VIEW')], loadComponent: () => import('./features/analytics/tax-simulation.component').then(m => m.TaxSimulationComponent) },
          { path: 'leakage', title: 'ANA.TABS.LEAKAGE', canActivate: [permissionGuard('ANALYTICS_VIEW')], loadComponent: () => import('./features/warehouse-insights/leakage-report.component').then(m => m.LeakageReportComponent) },
          { path: 'forecast', title: 'ANA.TABS.FORECAST', canActivate: [permissionGuard('ANALYTICS_VIEW')], loadComponent: () => import('./features/warehouse-insights/order-forecast.component').then(m => m.OrderForecastComponent) },
        ],
      },
      {
        path: 'sterilization',
        title: 'NAV.STERILIZATION',
        canActivate: [permissionGuard('STERILIZATION_MANAGE')],
        loadComponent: () => import('./features/sterilization/sterilization-layout.component').then(m => m.SterilizationLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
          { path: 'dashboard', title: 'STER.TABS.DASHBOARD', loadComponent: () => import('./features/sterilization/sterilization-dashboard.component').then(m => m.SterilizationDashboardComponent) },
          { path: 'scan', title: 'STER.TABS.SCAN', loadComponent: () => import('./features/sterilization/scan.component').then(m => m.ScanComponent) },
          { path: 'items', title: 'STER.TABS.ITEMS', loadComponent: () => import('./features/sterilization/sterilization-items.component').then(m => m.SterilizationItemsComponent) },
          { path: 'cycles', title: 'STER.TABS.CYCLES', loadComponent: () => import('./features/sterilization/sterilization-cycles.component').then(m => m.SterilizationCyclesComponent) },
          { path: 'trace', title: 'STER.TABS.TRACE', loadComponent: () => import('./features/sterilization/sterilization-trace.component').then(m => m.SterilizationTraceComponent) },
          { path: 'endo', title: 'STER.TABS.ENDO', loadComponent: () => import('./features/sterilization/sterilization-endo.component').then(m => m.SterilizationEndoComponent) },
        ],
      },
      {
        path: 'finance',
        title: 'NAV.FINANCE',
        canActivate: [permissionGuard('FINANCE_VIEW', 'BILLING_READ')],
        loadComponent: () => import('./features/finance/finance-layout.component').then(m => m.FinanceLayoutComponent),
        children: [
          { path: '', pathMatch: 'full', canActivate: [financeHomeGuard], children: [] },
          {
            path: 'dashboard',
            title: 'FIN.TABS.DASHBOARD',
            canActivate: [permissionGuard('FINANCE_VIEW')],
            loadComponent: () => import('./features/finance/pages/finance-dashboard.component').then(m => m.FinanceDashboardComponent),
          },
          {
            path: 'collections',
            title: 'FIN.TABS.COLLECTIONS',
            canActivate: [permissionGuard('FINANCE_VIEW')],
            loadComponent: () => import('./features/finance/pages/collections.component').then(m => m.CollectionsComponent),
          },
          {
            path: 'cash',
            title: 'FIN.TABS.CASH',
            canActivate: [permissionGuard('FINANCE_VIEW')],
            loadComponent: () => import('./features/finance/pages/cash-closing.component').then(m => m.CashClosingComponent),
          },
          {
            path: 'debts',
            title: 'FIN.TABS.DEBTS',
            canActivate: [permissionGuard('BILLING_READ')],
            loadComponent: () => import('./features/finance/pages/debts.component').then(m => m.DebtsComponent),
          },
          {
            path: 'instalments',
            title: 'FIN.TABS.INSTALMENTS',
            canActivate: [permissionGuard('BILLING_READ')],
            loadComponent: () => import('./features/finance/pages/instalments.component').then(m => m.InstalmentsComponent),
          },
          {
            path: 'cheques',
            title: 'FIN.TABS.CHEQUES',
            canActivate: [permissionGuard('BILLING_READ')],
            loadComponent: () => import('./features/finance/pages/cheques.component').then(m => m.ChequesComponent),
          },
          {
            path: 'expenses',
            title: 'FIN.TABS.EXPENSES',
            canActivate: [permissionGuard('FINANCE_VIEW')],
            loadComponent: () => import('./features/finance/pages/expenses.component').then(m => m.ExpensesComponent),
          },
          {
            path: 'tax-documents',
            title: 'FIN.TABS.TAX',
            canActivate: [permissionGuard('BILLING_READ')],
            loadComponent: () => import('./features/finance/pages/tax-documents.component').then(m => m.TaxDocumentsComponent),
          },
        ],
      },
      {
        path: 'billing',
        title: 'BILLING.TITLE',
        loadChildren: () => import('./features/billing/billing.routes').then(m => m.BILLING_ROUTES),
      },
      {
        path: 'stock',
        title: 'STOCK.TITLE',
        children: [
          {
            path: '',
            loadComponent: () => import('./features/stock/pages/stock-dashboard/stock-dashboard.component').then(m => m.StockDashboardComponent),
          },
          {
            path: 'procurement',
            title: 'STOCK.PROCUREMENT',
            loadComponent: () => import('./features/stock/pages/purchase-orders/purchase-orders.component').then(m => m.PurchaseOrdersComponent),
          },
          {
            path: 'direct-sales',
            title: 'STOCK.SALES',
            loadComponent: () => import('./features/stock/pages/sales-orders/sales-orders.component').then(m => m.SalesOrdersComponent),
          },
          {
            path: 'treatment-sessions',
            title: 'STOCK.TREATMENT_SESSIONS',
            loadComponent: () => import('./features/stock/pages/treatment-sessions/treatment-sessions.component').then(m => m.TreatmentSessionsComponent),
          },
          // The same two screens as under /analytics: whoever is standing in the
          // stockroom should not have to go looking in the accounts for them. They sit
          // under a layout that carries the stock nav, which the screens themselves
          // cannot own because /analytics renders them too.
          {
            path: '',
            canActivate: [permissionGuard('ANALYTICS_VIEW')],
            loadComponent: () => import('./features/warehouse-insights/stock-insights-layout.component').then(m => m.StockInsightsLayoutComponent),
            children: [
              { path: 'leakage', title: 'STOCK.LEAKAGE', loadComponent: () => import('./features/warehouse-insights/leakage-report.component').then(m => m.LeakageReportComponent) },
              { path: 'forecast', title: 'STOCK.FORECAST', loadComponent: () => import('./features/warehouse-insights/order-forecast.component').then(m => m.OrderForecastComponent) },
            ],
          },
        ]
      },
      {
        path: 'treatments',
        title: 'TREATMENTS.TITLE',
        loadComponent: () => import('./features/treatments/pages/treatments-list/treatments-list.component').then(m => m.TreatmentsListComponent),
      },
    ]
  },
  {
    path: '**',
    redirectTo: '',
  },
];
