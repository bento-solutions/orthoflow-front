import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { PatientService } from '../../../core/services/patient.service';
import { PatientApiService } from '../../../core/services/patient-api.service';
import { Patient } from '../../../core/models/patient.model';
import { TranslateModule } from '@ngx-translate/core';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { Insurer, PatientDirectoryApi } from '../patient-directory-api.service';

function notInFutureValidator(control: AbstractControl): ValidationErrors | null {
  if (!control.value) return null;
  const value = new Date(control.value);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return value > today ? { futureDate: true } : null;
}

@Component({
  selector: 'app-patient-registration',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule, TranslateModule],
  template: `
    <div class="registration-container">
      <header class="page-header">
        <button type="button" class="back-btn" [attr.aria-label]="'COMMON.BACK' | translate" [routerLink]="editMode ? ['/patients', patientId] : ['/patients']">
          <span class="material-icons" aria-hidden="true">arrow_back</span>
        </button>
        <div class="header-content">
          <h1>{{ (editMode ? 'PATIENTS.DOSSIER.EDIT_DOSSIER' : 'PATIENTS.DOSSIER.REGISTRATION_TITLE') | translate }}</h1>
          <p>{{ (editMode ? 'PATIENTS.DOSSIER.EDIT_SUBTITLE' : 'PATIENTS.DOSSIER.REGISTRATION_SUBTITLE') | translate }}</p>
        </div>
      </header>

      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
          <p>{{ 'COMMON.LOADING' | translate }}</p>
        </div>
      } @else {
        <form [formGroup]="patientForm" (ngSubmit)="onSubmit()" class="registration-form">
          <div class="form-grid">
            <!-- Identity Section -->
            <div class="form-section">
              <h2 class="section-title">{{ 'PATIENTS.DOSSIER.IDENTITY' | translate }}</h2>
              <div class="inputs-grid">
                <div class="form-group">
                  <label for="firstName">{{ 'PATIENTS.DOSSIER.FIRST_NAME' | translate }}</label>
                  <input id="firstName" formControlName="firstName" type="text" [placeholder]="'PATIENTS.DOSSIER.FIRST_NAME' | translate"
                    [attr.aria-invalid]="isInvalid('firstName')" />
                  @if (isInvalid('firstName')) {
                    <p class="field-error">{{ 'PATIENTS.DOSSIER.FIRST_NAME' | translate }} is required.</p>
                  }
                </div>
                <div class="form-group">
                  <label for="lastName">{{ 'PATIENTS.DOSSIER.LAST_NAME' | translate }}</label>
                  <input id="lastName" formControlName="lastName" type="text" [placeholder]="'PATIENTS.DOSSIER.LAST_NAME' | translate"
                    [attr.aria-invalid]="isInvalid('lastName')" />
                  @if (isInvalid('lastName')) {
                    <p class="field-error">{{ 'PATIENTS.DOSSIER.LAST_NAME' | translate }} is required.</p>
                  }
                </div>
                <div class="form-group">
                  <label for="dateOfBirth">{{ 'PATIENTS.DOSSIER.DOB' | translate }}</label>
                  <input id="dateOfBirth" formControlName="dateOfBirth" type="date" [attr.aria-invalid]="isInvalid('dateOfBirth')" />
                  @if (patientForm.controls.dateOfBirth.hasError('futureDate') && patientForm.controls.dateOfBirth.touched) {
                    <p class="field-error">Date of birth cannot be in the future.</p>
                  } @else if (isInvalid('dateOfBirth')) {
                    <p class="field-error">Date of birth is required.</p>
                  }
                </div>
                <div class="form-group">
                  <label for="gender">{{ 'PATIENTS.DOSSIER.GENDER' | translate }}</label>
                  <select id="gender" formControlName="gender">
                    <option value="M">{{ 'PATIENTS.DOSSIER.GENDER_M' | translate }}</option>
                    <option value="F">{{ 'PATIENTS.DOSSIER.GENDER_F' | translate }}</option>
                    <option value="O">{{ 'PATIENTS.DOSSIER.GENDER_O' | translate }}</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="cin">{{ 'PATIENTS.DOSSIER.CIN' | translate }} ({{ 'COMMON.RECOMMENDED' | translate }})</label>
                  <input id="cin" formControlName="cin" type="text" [placeholder]="'PATIENTS.DOSSIER.CIN_PLACEHOLDER' | translate" />
                </div>
                <div class="form-group">
                  <label for="guardianName">Guardian Name</label>
                  <input id="guardianName" formControlName="guardianName" type="text" placeholder="For minor patients" />
                </div>
                <div class="form-group">
                  <label for="guardianPhone">Guardian Phone</label>
                  <input id="guardianPhone" formControlName="guardianPhone" type="tel" placeholder="For minor patients" />
                </div>
                @if (editMode) {
                  <div class="form-group">
                    <label for="status">{{ 'COMMON.STATUS' | translate }}</label>
                    <select id="status" formControlName="status">
                      <option value="ACTIVE">{{ 'PATIENTS.DOSSIER.STATUS_ACTIVE' | translate }}</option>
                      <option value="COMPLETED">{{ 'PATIENTS.DOSSIER.STATUS_COMPLETED' | translate }}</option>
                      <option value="ON_HOLD">{{ 'PATIENTS.DOSSIER.STATUS_ON_HOLD' | translate }}</option>
                    </select>
                  </div>
                }
              </div>
            </div>

            <!-- Contact Section -->
            <div class="form-section">
              <h2 class="section-title">{{ 'PATIENTS.DOSSIER.CONTACT_INFO' | translate }}</h2>
              <div class="inputs-grid">
                <div class="form-group">
                  <label for="email">{{ 'PATIENTS.DOSSIER.EMAIL' | translate }} ({{ 'COMMON.OPTIONAL' | translate }})</label>
                  <input id="email" formControlName="email" type="email" [placeholder]="'PATIENTS.DOSSIER.EMAIL_PLACEHOLDER' | translate" />
                  @if (patientForm.controls.email.hasError('email') && patientForm.controls.email.touched) {
                    <p class="field-error">Enter a valid email address.</p>
                  }
                </div>
                <div class="form-group">
                  <label for="phone">{{ 'PATIENTS.DOSSIER.PHONE' | translate }}</label>
                  <input id="phone" formControlName="phone" type="tel" [placeholder]="'PATIENTS.DOSSIER.PHONE_PLACEHOLDER' | translate"
                    [attr.aria-invalid]="isInvalid('phone')" />
                  @if (isInvalid('phone')) {
                    <p class="field-error">Phone number is required.</p>
                  }
                </div>
                <div class="form-group full-width">
                  <label for="address">{{ 'PATIENTS.DOSSIER.ADDRESS' | translate }} ({{ 'COMMON.OPTIONAL' | translate }})</label>
                  <textarea id="address" formControlName="address" rows="2" [placeholder]="'PATIENTS.DOSSIER.ADDRESS_PLACEHOLDER' | translate"></textarea>
                </div>
              </div>
            </div>

            <!-- Insurance Section -->
            <div class="form-section">
              <h2 class="section-title">{{ 'PATIENTS.DOSSIER.INSURANCE' | translate }}</h2>
              <div class="inputs-grid">
                <div class="form-group">
                  <label for="insurerId">{{ 'PATIENTS.DOSSIER.INSURANCE' | translate }}</label>
                  <select id="insurerId" formControlName="insurerId">
                    <option value="">{{ 'PATIENTS.DOSSIER.INSURANCE_NONE' | translate }}</option>
                    @for (i of insurers(); track i.id) { <option [value]="i.id">{{ i.name }}</option> }
                  </select>
                </div>
                <div class="form-group">
                  <label for="insuranceNumber">{{ 'PATIENTS.DOSSIER.POLICY_NUMBER' | translate }}</label>
                  <input id="insuranceNumber" formControlName="insuranceNumber" type="text" maxlength="100" />
                </div>
                <div class="form-group">
                  <label for="insuranceAffiliationNumber">{{ 'PATIENTS.DOSSIER.AFFILIATION_NUMBER' | translate }} ({{ 'COMMON.OPTIONAL' | translate }})</label>
                  <input id="insuranceAffiliationNumber" formControlName="insuranceAffiliationNumber" type="text" maxlength="50" />
                </div>
                <div class="form-group">
                  <label for="insuredRelation">{{ 'PATIENTS.DOSSIER.INSURED_RELATION' | translate }}</label>
                  <select id="insuredRelation" formControlName="insuredRelation">
                    <option value="SELF">{{ 'PATIENTS.DOSSIER.RELATION_SELF' | translate }}</option>
                    <option value="CHILD">{{ 'PATIENTS.DOSSIER.RELATION_CHILD' | translate }}</option>
                    <option value="SPOUSE">{{ 'PATIENTS.DOSSIER.RELATION_SPOUSE' | translate }}</option>
                  </select>
                </div>
                @if (patientForm.controls.insuredRelation.value !== 'SELF') {
                  <div class="form-group">
                    <label for="insuredName">{{ 'PATIENTS.DOSSIER.INSURED_NAME' | translate }}</label>
                    <input id="insuredName" formControlName="insuredName" type="text" maxlength="255" />
                  </div>
                  <div class="form-group">
                    <label for="insuredCin">{{ 'PATIENTS.DOSSIER.INSURED_CIN' | translate }}</label>
                    <input id="insuredCin" formControlName="insuredCin" type="text" maxlength="50" />
                  </div>
                }
              </div>
            </div>

            @if (!editMode) {
              <div class="form-section">
                <h2 class="section-title">{{ 'PATIENTS.DOSSIER.CONSENT_TITLE' | translate }}</h2>
                <label class="consent-checkbox">
                  <input type="checkbox" formControlName="consentGiven" />
                  <span>{{ 'PATIENTS.DOSSIER.CONSENT_TEXT' | translate }}</span>
                </label>
                <p class="consent-hint">{{ 'PATIENTS.DOSSIER.CONSENT_HINT' | translate }}</p>
              </div>
            }
          </div>

          <div class="form-actions">
            <button type="button" class="btn-form-cancel" [routerLink]="editMode ? ['/patients', patientId] : ['/patients']">{{ 'COMMON.CANCEL' | translate }}</button>
            <button type="submit" class="btn btn-primary" [disabled]="patientForm.invalid">
              {{ (editMode ? 'COMMON.EDIT' : 'COMMON.ADD') | translate }} {{ 'PATIENTS.NAME' | translate }}
            </button>
          </div>
        </form>
      }
    </div>
  `,
  styles: [`
    .registration-container {
      padding: 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }

    .back-btn {
      background: var(--surface);
      border: 1px solid rgb(var(--ink-200));
      padding: 0.5rem;
      min-width: 44px;
      min-height: 44px;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .back-btn:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .back-btn:hover {
      background: rgb(var(--ink-50));
      border-color: rgb(var(--ink-300));
    }

    .header-content h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: rgb(var(--ink-900));
      margin: 0;
    }

    .header-content p {
      color: rgb(var(--ink-500));
      margin: 0.25rem 0 0 0;
    }

    .registration-form {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .form-section {
      background: var(--surface);
      padding: 2rem;
      border-radius: 16px;
      border: 1px solid rgb(var(--ink-200));
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
    }

    .section-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: rgb(var(--ink-700));
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid rgb(var(--ink-100));
    }

    .inputs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-group.full-width {
      grid-column: 1 / -1;
    }

    .field-error {
      margin: 0;
      font-size: 0.8rem;
      color: rgb(var(--critical-600));
    }

    .consent-checkbox {
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      font-size: 0.9rem;
      color: rgb(var(--ink-700));
      cursor: pointer;
    }
    .consent-checkbox input {
      margin-top: 0.2rem;
    }
    .consent-hint {
      margin: 0.5rem 0 0 1.7rem;
      font-size: 0.8rem;
      color: rgb(var(--ink-400));
    }

    .form-group label {
      font-size: 0.875rem;
      font-weight: 500;
      color: rgb(var(--ink-600));
    }

    .form-group input, 
    .form-group select, 
    .form-group textarea {
      padding: 0.75rem;
      border: 1px solid rgb(var(--ink-300));
      border-radius: 8px;
      font-size: 0.95rem;
      transition: all 0.2s ease;
      outline: none;
    }

    .form-group input:focus, 
    .form-group select:focus, 
    .form-group textarea:focus {
      border-color: rgb(var(--petrol-900));
      box-shadow: 0 0 0 3px rgba(3, 4, 94, 0.1);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 1rem;
    }

    /* Named distinctly from the shared .btn-ghost (which this doesn't match:
       it keeps a visible border) so it doesn't shadow the canonical class. */
    .btn-form-cancel {
      background: transparent;
      border: 1px solid rgb(var(--ink-200));
      color: rgb(var(--ink-500));
      padding: 0.75rem 2rem;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .btn-form-cancel:hover {
      background: rgb(var(--ink-50));
      color: rgb(var(--ink-700));
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      color: rgb(var(--ink-500));
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid rgb(var(--ink-100));
      border-top: 4px solid rgb(var(--petrol-900));
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 1rem;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Responsive Styles */
    @media (max-width: 768px) {
      .registration-container {
        padding: 1rem;
      }

      .page-header {
        gap: 1rem;
        margin-bottom: 1.5rem;
      }

      .header-content h1 {
        font-size: 1.5rem;
      }

      .form-section {
        padding: 1.5rem;
      }

      .inputs-grid {
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      .form-actions {
        flex-direction: column-reverse;
      }

      .form-actions button {
        width: 100%;
      }
    }
  `]
})
export class PatientRegistrationComponent implements OnInit {
  private fb = inject(FormBuilder);
  private patientService = inject(PatientService);
  private patientApi = inject(PatientApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private confirmDialog = inject(ConfirmDialogService);

  editMode = false;
  patientId: string | null = null;
  loading = this.patientService.loading;

  patientForm = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    // Optional email + address per audit VIII.4: most paediatric and many
    // elderly Moroccan patients have no email, and a first-contact
    // registration doesn't always know the address yet. Blocking on either
    // was a hard stop at the product's front door.
    dateOfBirth: ['', [Validators.required, notInFutureValidator]],
    gender: ['M', Validators.required],
    email: ['', [Validators.email]],
    phone: ['', Validators.required],
    address: [''],
    cin: [''],
    guardianName: [''],
    guardianPhone: [''],
    insuranceProvider: [''],
    insurerId: [''],
    insuranceNumber: [''],
    insuranceAffiliationNumber: [''],
    insuredRelation: ['SELF'],
    insuredName: [''],
    insuredCin: [''],
    status: ['ACTIVE'],
    consentGiven: [false]
  });

  /** The clinic's insurers: picking one (not typing a name) is what lets its own care form be filled. */
  insurers = signal<Insurer[]>([]);
  private readonly directory = inject(PatientDirectoryApi);

  ngOnInit() {
    this.directory.insurers().then(list => {
      this.insurers.set(list);
      this.matchTypedInsurer();
    }).catch(() => undefined);
    this.patientId = this.route.snapshot.paramMap.get('id');
    if (this.patientId && this.patientId !== 'register') {
      this.editMode = true;
      this.loadPatientData(this.patientId);
    }
  }

  loadPatientData(id: string) {
    this.patientService.setCurrentPatient(id).subscribe({
      next: (patient) => {
        const p = patient as any;
        this.patientForm.patchValue({ ...p, insurerId: p.insurerId ?? '', insuredRelation: p.insuredRelation ?? 'SELF' });
        this.matchTypedInsurer();
      },
      error: (err) => console.error('Failed to load patient for editing', err)
    });
  }

  /**
   * A patient saved before insurers were a list carries the insurer as text ("CNOPS"):
   * select the clinic's insurer of that code or name, so saving links it.
   */
  private matchTypedInsurer(): void {
    const controls = this.patientForm.controls;
    const typed = (controls.insuranceProvider.value ?? '').trim().toLowerCase();
    if (controls.insurerId.value || !typed) return;
    const match = this.insurers().find(i => i.code.toLowerCase() === typed || i.name.toLowerCase() === typed);
    if (match) controls.insurerId.setValue(match.id);
  }

  isInvalid(controlName: keyof typeof this.patientForm.controls): boolean {
    const control = this.patientForm.controls[controlName];
    return control.invalid && (control.dirty || control.touched);
  }

  /**
   * Same name + date of birth registering twice used to succeed silently
   * (audit VIII.4). This is a heuristic warning, not a hard block — some
   * clinics do see siblings or name collisions.
   */
  private findPossibleDuplicate(firstName: string, lastName: string, dateOfBirth: string) {
    return this.patientService.patients().find(p =>
      p.firstName.trim().toLowerCase() === firstName.trim().toLowerCase() &&
      p.lastName.trim().toLowerCase() === lastName.trim().toLowerCase() &&
      p.dateOfBirth === dateOfBirth
    );
  }

  async onSubmit() {
    if (!this.patientForm.valid) {
      this.patientForm.markAllAsTouched();
      return;
    }

    const patientData = { ...this.patientForm.value } as any;
    const consentGiven = !!patientData.consentGiven;
    delete patientData.consentGiven;
    // The insurer is the clinic's record; its name stays in the text field the older screens read.
    // Until the list has loaded the choice is unknown, so the record's insurer is left as it is.
    if (this.insurers().length) {
      const insurer = this.insurers().find(i => i.id === patientData.insurerId);
      patientData.insurerId = insurer?.id ?? null;
      patientData.insuranceProvider = insurer?.name ?? '';
    } else {
      delete patientData.insurerId;
    }
    if (patientData.insuredRelation === 'SELF') {
      patientData.insuredName = '';
      patientData.insuredCin = '';
    }

    if (!this.editMode) {
      const duplicate = this.findPossibleDuplicate(patientData.firstName, patientData.lastName, patientData.dateOfBirth);
      if (duplicate) {
        const proceed = await this.confirmDialog.confirm(
          `A patient named ${duplicate.firstName} ${duplicate.lastName} with the same date of birth already exists. Register anyway?`,
          { confirmLabel: 'Register Anyway' }
        );
        if (!proceed) return;
      }
    }

    if (this.editMode && this.patientId) {
      this.patientService.updatePatient(this.patientId, patientData).subscribe({
        next: () => {
          this.toast.success('Patient updated.');
          this.router.navigate(['/patients', this.patientId]);
        },
        error: (err) => {
          console.error('Error updating patient', err);
          this.toast.error('Could not save changes. Please try again.');
        }
      });
    } else {
      this.patientService.addPatient(patientData).subscribe({
        next: (created) => {
          this.toast.success('Patient registered.');
          if (consentGiven && created?.id) {
            // Best-effort: consent capture failing shouldn't block
            // registration completing, since the patient record itself
            // saved successfully — surface it as a separate, non-blocking
            // toast rather than an error on the whole submit.
            this.patientApi.recordConsent(created.id).subscribe({
              error: (err) => {
                console.error('Error recording consent', err);
                this.toast.error('Patient saved, but consent could not be recorded. Record it from Settings.');
              }
            });
          }
          this.router.navigate(['/patients']);
        },
        error: (err) => {
          console.error('Error creating patient', err);
          this.toast.error('Could not register the patient. Please try again.');
        }
      });
    }
  }
}
