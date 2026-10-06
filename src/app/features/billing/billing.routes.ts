import { Routes } from '@angular/router';

export const BILLING_ROUTES: Routes = [
  {
    path: '',
    children: [
      {
        path: 'invoices',
        loadComponent: () => import('./pages/invoice-list/invoice-list.component').then(m => m.InvoiceListComponent),
      },
      {
        path: 'invoices/create',
        loadComponent: () => import('./pages/invoice-create/invoice-create.component').then(m => m.InvoiceCreateComponent),
      },
      {
        // Quotes are not built: the page shows nothing real and its "New quote" button does nothing, and
        // the backend has no quote model. It is kept out of reach, not deleted, until quotes exist.
        path: 'quotes',
        redirectTo: 'invoices',
        pathMatch: 'full',
      },
      {
        path: 'invoices/:id',
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
