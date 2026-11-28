import { Routes } from '@angular/router';

export const BILLING_ROUTES: Routes = [
  {
    path: '',
    children: [
      {
        path: 'invoices',
        title: 'BILLING.INVOICES',
        loadComponent: () => import('./pages/invoice-list/invoice-list.component').then(m => m.InvoiceListComponent),
      },
      {
        path: 'invoices/create',
        title: 'BILLING.NEW_INVOICE',
        loadComponent: () => import('./pages/invoice-create/invoice-create.component').then(m => m.InvoiceCreateComponent),
      },
      {
        // Every devis of the clinic; each is written and handled in the patient's file.
        path: 'quotes',
        title: 'BILLING.QUOTES',
        loadComponent: () => import('./pages/quote-list/quote-list.component').then(m => m.QuoteListComponent),
      },
      {
        path: 'invoices/:id',
        title: 'BILLING.INVOICE_DETAIL',
        loadComponent: () => import('./pages/invoice-detail/invoice-detail.component').then(m => m.InvoiceDetailComponent),
      },
      {
        path: '',
        redirectTo: 'invoices',
        pathMatch: 'full'
      }
    ]
  }
];
