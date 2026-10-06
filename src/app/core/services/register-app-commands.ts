import { Router } from '@angular/router';
import { Permission } from '../models/permission';
import { Command, CommandRegistryService } from './command-registry.service';
import { HelpPanelService } from './help-panel.service';
import { ThemeService } from './theme.service';

/**
 * What the ⌘K palette can do. Navigation and safe actions only: nothing here writes clinical or
 * financial data (those stay behind their own confirmation, reached by going to the screen
 * first). Labels are translation keys (`CMD.*`), keywords are given in all three languages so a
 * search in French finds a command whatever language the screen is in, and a command carries the
 * permission its screen needs, so the palette never offers a door the menu keeps shut.
 * Called once from the app component's constructor.
 */
export function registerAppCommands(registry: CommandRegistryService, router: Router, help?: HelpPanelService, theme?: ThemeService): void {
  const go = (path: string) => () => void router.navigateByUrl(path);

  const nav = (id: string, label: string, path: string, icon: string, keywords: string[], permission?: Permission[]): Command => ({
    id, label, category: 'navigation', icon, keywords, execute: go(path), permission,
  });
  const action = (id: string, label: string, path: string, icon: string, keywords: string[], permission?: Permission[]): Command => ({
    id, label, category: 'action', icon, keywords, execute: go(path), permission,
  });

  const commands: Command[] = [
    // ── Clinical ───────────────────────────────────────────────────────
    nav('nav.dashboard', 'CMD.DASHBOARD', '/', 'dashboard', ['home', 'overview', 'accueil', 'vue d\'ensemble', 'الرئيسية']),
    nav('nav.patients', 'CMD.PATIENTS', '/patients', 'people', ['patient list', 'liste des patients', 'dossiers', 'المرضى'], ['PATIENT_READ']),
    action('nav.patients.register', 'CMD.PATIENT_NEW', '/patients/register', 'person_add', ['add patient', 'create patient', 'register', 'nouveau patient', 'ajouter un patient', 'مريض جديد'], ['PATIENT_WRITE']),
    nav('nav.patients.duplicates', 'CMD.DUPLICATES', '/patients/duplicates', 'merge_type', ['merge', 'doublons', 'fusionner', 'مكررات'], ['PATIENT_MERGE']),
    nav('nav.schedule', 'CMD.SCHEDULE', '/schedule', 'event', ['calendar', 'appointments', 'agenda', 'rendez-vous', 'المواعيد'], ['AGENDA_VIEW']),
    action('action.schedule.new', 'CMD.APPOINTMENT_NEW', '/schedule', 'event_available', ['book appointment', 'new appointment', 'prendre rendez-vous', 'nouveau rendez-vous', 'حجز موعد'], ['AGENDA_MANAGE']),
    nav('nav.front-desk', 'CMD.FRONT_DESK', '/front-desk', 'meeting_room', ['waiting room', 'waiting list', 'accueil', 'salle d\'attente', 'liste d\'attente', 'الاستقبال'], ['AGENDA_VIEW', 'WAITING_ROOM_MANAGE']),
    nav('nav.recalls', 'CMD.RECALLS', '/recalls', 'phone_callback', ['recall', 'follow up', 'rappels', 'relance', 'متابعة'], ['AGENDA_VIEW']),
    nav('nav.treatments', 'CMD.TREATMENTS', '/treatments', 'healing', ['procedures', 'treatment catalog', 'traitements', 'actes', 'العلاجات']),
    nav('nav.lab-orders', 'CMD.LAB_ORDERS', '/lab-orders', 'science', ['lab', 'laboratory', 'prosthesis', 'labo', 'laboratoire', 'prothèse', 'المختبر'], ['LAB_ORDERS_MANAGE']),
    nav('nav.tasks', 'CMD.TASKS', '/tasks', 'checklist', ['to do', 'todo', 'tâches', 'à faire', 'المهام'], ['TASKS_MANAGE']),

    // ── Sterilization ──────────────────────────────────────────────────
    nav('nav.sterilization', 'CMD.STERILIZATION', '/sterilization', 'sanitizer', ['autoclave', 'instruments', 'stérilisation', 'التعقيم'], ['STERILIZATION_MANAGE']),
    action('nav.sterilization.scan', 'CMD.STER_SCAN', '/sterilization/scan', 'qr_code_scanner', ['scan', 'qr', 'barcode', 'scanner', 'étiquette', 'مسح'], ['STERILIZATION_MANAGE']),
    nav('nav.sterilization.cycles', 'CMD.STER_CYCLES', '/sterilization/cycles', 'autorenew', ['autoclave cycle', 'cycles', 'contrôle', 'دورات'], ['STERILIZATION_MANAGE']),
    nav('nav.sterilization.trace', 'CMD.STER_TRACE', '/sterilization/trace', 'timeline', ['traceability', 'traçabilité', 'التتبع'], ['STERILIZATION_MANAGE']),
    nav('nav.sterilization.endo', 'CMD.STER_ENDO', '/sterilization/endo', 'vaccines', ['endo files', 'limes', 'endodontie', 'مبارد'], ['STERILIZATION_MANAGE']),

    // ── Money ──────────────────────────────────────────────────────────
    nav('nav.billing', 'CMD.BILLING', '/billing/invoices', 'payments', ['invoices', 'invoicing', 'factures', 'facturation', 'الفواتير'], ['BILLING_READ']),
    action('nav.billing.create', 'CMD.INVOICE_NEW', '/billing/invoices/create', 'receipt_long', ['create invoice', 'bill patient', 'nouvelle facture', 'facturer', 'فاتورة جديدة'], ['BILLING_WRITE']),
    nav('nav.finance', 'CMD.FINANCE', '/finance', 'account_balance_wallet', ['finance', 'money', 'dashboard', 'finances', 'argent', 'المالية'], ['FINANCE_VIEW', 'BILLING_READ']),
    nav('nav.finance.collections', 'CMD.COLLECTIONS', '/finance/collections', 'savings', ['payments received', 'encaissements', 'caisse', 'المقبوضات'], ['FINANCE_VIEW']),
    nav('nav.finance.cash', 'CMD.CASH_CLOSING', '/finance/cash', 'point_of_sale', ['close the day', 'cash', 'clôture de caisse', 'fermer la journée', 'إقفال الصندوق'], ['FINANCE_VIEW']),
    nav('nav.finance.debts', 'CMD.DEBTS', '/finance/debts', 'request_quote', ['unpaid', 'balances', 'owed', 'créances', 'impayés', 'dettes', 'reste dû', 'ديون'], ['BILLING_READ']),
    nav('nav.finance.instalments', 'CMD.INSTALMENTS', '/finance/instalments', 'event_repeat', ['payment plan', 'échéances', 'échéancier', 'الأقساط'], ['BILLING_READ']),
    nav('nav.finance.cheques', 'CMD.CHEQUES', '/finance/cheques', 'payments', ['cheque', 'check', 'chèques', 'الشيكات'], ['BILLING_READ']),
    nav('nav.finance.expenses', 'CMD.EXPENSES', '/finance/expenses', 'receipt', ['expenses', 'costs', 'dépenses', 'charges', 'المصاريف'], ['FINANCE_VIEW']),
    nav('nav.finance.tax', 'CMD.TAX_DOCUMENTS', '/finance/tax-documents', 'description', ['fee note', 'note d\'honoraires', 'feuille de soins', 'documents fiscaux', 'مذكرة أتعاب'], ['BILLING_READ']),
    nav('nav.retrocessions', 'CMD.RETROCESSIONS', '/retrocessions', 'percent', ['doctor pay', 'rétrocessions', 'paie des praticiens', 'الاستردادات'], ['RETROCESSION_VIEW']),
    nav('nav.analytics', 'CMD.ANALYTICS', '/analytics', 'insights', ['reports', 'statistics', 'analytique', 'statistiques', 'rapports', 'التحليلات'], ['ANALYTICS_VIEW', 'FINANCE_VIEW']),
    nav('nav.analytics.income', 'CMD.INCOME_STATEMENT', '/analytics/income', 'balance', ['cpc', 'income statement', 'compte de résultat', 'حساب النتائج'], ['FINANCE_VIEW']),
    nav('nav.analytics.goals', 'CMD.GOALS', '/analytics/goals', 'flag', ['target', 'objective', 'objectif', 'الهدف'], ['FINANCE_VIEW']),

    // ── Stock ──────────────────────────────────────────────────────────
    nav('nav.stock', 'CMD.STOCK', '/stock', 'inventory_2', ['inventory', 'catalog', 'stock', 'inventaire', 'المخزون'], ['STOCK_READ']),
    nav('nav.stock.procurement', 'CMD.PROCUREMENT', '/stock/procurement', 'local_shipping', ['purchase order', 'po', 'delivery note', 'grni', 'commandes', 'achats'], ['STOCK_READ']),
    nav('nav.stock.sales', 'CMD.SALES', '/stock/direct-sales', 'point_of_sale', ['sales order', 'so', 'ventes'], ['STOCK_READ']),
    nav('nav.stock.sessions', 'CMD.SESSIONS', '/stock/treatment-sessions', 'medical_information', ['treatment session', 'consumables', 'séances', 'consommables'], ['STOCK_READ']),

    // ── Communication ──────────────────────────────────────────────────
    nav('nav.messages', 'CMD.MESSAGES', '/messages', 'forum', ['staff messages', 'chat', 'messages internes', 'رسائل'], undefined),
    nav('nav.communication', 'CMD.COMMUNICATION', '/communication', 'send', ['whatsapp', 'email', 'sms', 'communication', 'historique des messages', 'التواصل'], ['MESSAGING_VIEW']),
    nav('nav.communication.inbox', 'CMD.WHATSAPP_REPLIES', '/communication/inbox', 'inbox', ['whatsapp replies', 'réponses whatsapp', 'ردود واتساب'], ['MESSAGING_VIEW']),
    nav('nav.communication.templates', 'CMD.TEMPLATES', '/communication/templates', 'edit_note', ['message templates', 'modèles de messages', 'قوالب'], ['MESSAGING_VIEW']),
    nav('nav.booking', 'CMD.BOOKING', '/booking', 'event_note', ['online booking', 'requests', 'demandes en ligne', 'prise de rendez-vous en ligne', 'طلبات'], ['BOOKING_REVIEW']),
    nav('nav.booking.registrations', 'CMD.REGISTRATIONS', '/booking/registrations', 'how_to_reg', ['new patient forms', 'self registration', 'fiches patients', 'inscriptions', 'استمارات'], ['BOOKING_REVIEW']),
    nav('nav.surveys', 'CMD.SURVEYS', '/surveys', 'sentiment_satisfied', ['satisfaction', 'feedback', 'enquêtes', 'avis', 'استطلاعات'], ['SURVEYS_VIEW']),

    // ── Settings and account ───────────────────────────────────────────
    nav('nav.settings', 'CMD.SETTINGS', '/settings', 'settings', ['preferences', 'configuration', 'paramètres', 'réglages', 'الإعدادات'], ['SETTINGS_MANAGE', 'USERS_MANAGE']),
    nav('nav.settings.hours', 'CMD.OPENING_HOURS', '/settings/hours', 'schedule', ['opening hours', 'horaires', 'heures d\'ouverture', 'ساعات العمل'], ['SETTINGS_MANAGE']),
    nav('nav.settings.team', 'CMD.TEAM', '/settings/team', 'groups', ['practitioners', 'doctors', 'équipe', 'praticiens', 'الفريق'], ['SETTINGS_MANAGE']),
    nav('nav.settings.users', 'CMD.USERS', '/settings/users', 'manage_accounts', ['users', 'permissions', 'roles', 'utilisateurs', 'droits', 'المستخدمون'], ['USERS_MANAGE']),
    nav('nav.account', 'CMD.ACCOUNT', '/account', 'account_circle', ['profile', 'password', 'mon compte', 'mot de passe', 'حسابي']),
  ];

  if (help) {
    commands.push({ id: 'action.help', label: 'CMD.HELP', category: 'action', icon: 'help', keywords: ['help', 'tour', 'aide', 'visite guidée', 'مساعدة'], execute: () => help.show() });
  }
  if (theme) {
    commands.push({ id: 'action.theme', label: 'CMD.THEME', category: 'action', icon: 'dark_mode', keywords: ['dark mode', 'light mode', 'theme', 'thème', 'mode sombre', 'mode clair', 'الوضع الداكن'], execute: () => theme.toggle() });
  }

  registry.registerMany(commands);
}
