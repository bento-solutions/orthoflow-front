import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CabinetService, CabinetInfo } from '../../core/services/cabinet.service';
import { AuthApiService } from '../../core/services/auth-api.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ToastService } from '../../core/services/toast.service';
import { readAndValidateLogo, LogoValidationError } from '../../core/utils/logo-upload';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <main class="h-screen w-screen bg-[rgb(var(--ink-50))] dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col justify-between items-center overflow-hidden p-6 relative select-none">
      
      <!-- Background decorative gradients matching webapp -->
      <div class="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-ortho-sky/10 blur-3xl"></div>
      <div class="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-ortho-teal/10 blur-3xl"></div>

      <!-- App Header logo / name -->
      <header class="w-full max-w-md flex justify-between items-center z-10 shrink-0">
        <div class="flex items-center gap-2">
          <div class="h-8 w-8 rounded-lg bg-petrol-600 flex items-center justify-center text-white font-extrabold text-sm shadow-md">O</div>
          <span class="font-extrabold tracking-tight text-ink-900 dark:text-white text-base">OrthoFlow</span>
        </div>
        
        <!-- Language selector -->
        <div class="flex gap-2 text-xs font-semibold text-slate-500">
          <button type="button" lang="fr" aria-label="Français" [attr.aria-pressed]="isLang('fr')" (click)="changeLang('fr')" class="hover:text-ink-900" [class.text-ink-900]="isLang('fr')">FR</button>
          <span aria-hidden="true">|</span>
          <button type="button" lang="en" aria-label="English" [attr.aria-pressed]="isLang('en')" (click)="changeLang('en')" class="hover:text-ink-900" [class.text-ink-900]="isLang('en')">EN</button>
          <span aria-hidden="true">|</span>
          <button type="button" lang="ar" aria-label="العربية" [attr.aria-pressed]="isLang('ar')" (click)="changeLang('ar')" class="hover:text-ink-900" [class.text-ink-900]="isLang('ar')">AR</button>
        </div>
      </header>

      <!-- Center Wizard Container (Strictly sized to never scroll) -->
      <div class="w-full max-w-md flex-1 flex flex-col justify-center z-10 my-4 overflow-hidden">
        <div class="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl shadow-xl p-6 flex flex-col max-h-[85vh] overflow-hidden">
          
          <!-- STEP 0: Welcome Screen (Hello Animation) -->
          @if (currentStep() === 0) {
            <div class="step-container flex-1 flex flex-col justify-between py-4 text-center">
              <div class="my-auto space-y-4">
                <h1 class="welcome-hello text-4xl font-extrabold text-ink-900 dark:text-white tracking-tight">
                  {{ 'ONBOARDING.UI.HELLO' | translate }}
                </h1>
                <p class="welcome-sub text-lg text-slate-500 dark:text-slate-500 font-medium px-4">
                  {{ 'ONBOARDING.UI.WELCOME' | translate }}
                </p>
              </div>
              <button 
                type="button"
                (click)="nextStep()"
                class="w-full py-3.5 bg-petrol-600 text-white font-bold rounded-xl shadow-md hover:bg-petrol-700 hover:shadow-lg transition-all active:scale-[0.98] shrink-0"
              >
                {{ 'ONBOARDING.UI.GET_STARTED' | translate }}
              </button>
            </div>
          }

          <!-- STEP 1: Role Selection -->
          @if (currentStep() === 1) {
            <div class="step-container flex-1 flex flex-col justify-between overflow-hidden">
              <div class="space-y-4 overflow-y-auto pe-1">
                <div>
                  <h2 class="text-xl font-bold text-ink-900 dark:text-white tracking-tight">{{ 'ONBOARDING.UI.WHO' | translate }}</h2>
                  <p class="text-xs text-slate-500 mt-0.5">{{ 'ONBOARDING.UI.WHO_HINT' | translate }}</p>
                </div>

                <div class="grid grid-cols-1 gap-3 py-2">
                  <!-- Doctor Option Card -->
                  <button 
                    type="button" 
                    (click)="selectedRole.set('doctor')"
                    [ngClass]="{
                      'border-ortho-sky bg-ortho-ice/30 ring-2 ring-ortho-sky/20': selectedRole() === 'doctor',
                      'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700': selectedRole() !== 'doctor'
                    }"
                    class="p-4 rounded-xl border text-left transition-all flex items-center gap-4 group"
                  >
                    <div 
                      [ngClass]="{
                        'bg-petrol-600 text-white': selectedRole() === 'doctor',
                        'bg-slate-100 text-slate-500 dark:bg-slate-800': selectedRole() !== 'doctor'
                      }"
                      class="h-12 w-12 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    </div>
                    <div>
                      <p class="font-bold text-sm text-slate-900 dark:text-white" [class.text-ink-900]="selectedRole() === 'doctor'">{{ 'ONBOARDING.UI.ROLE_DOCTOR' | translate }}</p>
                      <p class="text-xs text-slate-500 mt-0.5">{{ 'ONBOARDING.UI.ROLE_DOCTOR_HINT' | translate }}</p>
                    </div>
                  </button>

                  <!-- Assistant Option Card -->
                  <button 
                    type="button" 
                    (click)="selectedRole.set('assistant')"
                    [ngClass]="{
                      'border-ortho-sky bg-ortho-ice/30 ring-2 ring-ortho-sky/20': selectedRole() === 'assistant',
                      'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700': selectedRole() !== 'assistant'
                    }"
                    class="p-4 rounded-xl border text-left transition-all flex items-center gap-4 group"
                  >
                    <div 
                      [ngClass]="{
                        'bg-petrol-600 text-white': selectedRole() === 'assistant',
                        'bg-slate-100 text-slate-500 dark:bg-slate-800': selectedRole() !== 'assistant'
                      }"
                      class="h-12 w-12 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-3-3.87"></path><path d="M9 21v-2a4 4 0 0 0-4-4H3a4 4 0 0 0-4 4v2"></path><circle cx="6" cy="7" r="4"></circle><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    </div>
                    <div>
                      <p class="font-bold text-sm text-slate-900 dark:text-white" [class.text-ink-900]="selectedRole() === 'assistant'">{{ 'ONBOARDING.UI.ROLE_ASSISTANT' | translate }}</p>
                      <p class="text-xs text-slate-500 mt-0.5">{{ 'ONBOARDING.UI.ROLE_ASSISTANT_HINT' | translate }}</p>
                    </div>
                  </button>
                </div>
              </div>

              <!-- Nav controls -->
              <div class="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex justify-end shrink-0">
                <button 
                  type="button" 
                  (click)="nextStep()"
                  [disabled]="!selectedRole()"
                  class="btn-primary px-6 py-3 bg-petrol-600 hover:bg-petrol-700 text-white font-bold rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none transition-all active:scale-[0.98]"
                >
                  {{ 'ONBOARDING.UI.CONTINUE' | translate }}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </button>
              </div>
            </div>
          }

          <!-- STEP 2: Account Creation -->
          @if (currentStep() === 2) {
            <div class="step-container flex-1 flex flex-col justify-between overflow-hidden">
              <div class="space-y-4 overflow-y-auto pe-1">
                <div>
                  <h2 class="text-xl font-bold text-ink-900 dark:text-white tracking-tight">{{ 'ONBOARDING.UI.CREATE_ACCOUNT' | translate }}</h2>
                  <p class="text-xs text-slate-500 mt-0.5">{{ 'ONBOARDING.UI.CREATE_ACCOUNT_HINT' | translate }}</p>
                </div>

                @if (accountError()) {
                  <div class="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300 space-y-2" role="alert">
                    <p>{{ accountError() }}</p>
                    @if (accountExists()) {
                      <button
                        type="button"
                        (click)="goToLogin()"
                        class="w-full py-2 bg-red-700 hover:bg-red-800 text-white font-bold rounded-lg text-xs transition-all active:scale-[0.98]"
                      >
                        {{ 'ONBOARDING.UI.GO_TO_LOGIN' | translate }}
                      </button>
                    }
                  </div>
                }

                <div class="space-y-3.5">
                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1.5">
                      <label for="onboarding-accountFirstName" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.FIRST_NAME' | translate }} <span aria-hidden="true">*</span></label>
                      <input id="onboarding-accountFirstName" type="text" [(ngModel)]="accountFirstName" placeholder="Amine"
                        class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none transition-all focus:border-ortho-sky focus:ring-4 focus:ring-ortho-sky/5 text-slate-900 dark:text-white" />
                    </div>
                    <div class="space-y-1.5">
                      <label for="onboarding-accountLastName" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.LAST_NAME' | translate }} <span aria-hidden="true">*</span></label>
                      <input id="onboarding-accountLastName" type="text" [(ngModel)]="accountLastName" placeholder="El Mansouri"
                        class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none transition-all focus:border-ortho-sky focus:ring-4 focus:ring-ortho-sky/5 text-slate-900 dark:text-white" />
                    </div>
                  </div>
                  <div class="space-y-1.5">
                    <label for="onboarding-accountEmail" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.EMAIL' | translate }} <span aria-hidden="true">*</span></label>
                    <input id="onboarding-accountEmail" type="email" [(ngModel)]="accountEmail" placeholder="doctor@orthoflow.com" autocomplete="username"
                      class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none transition-all focus:border-ortho-sky focus:ring-4 focus:ring-ortho-sky/5 text-slate-900 dark:text-white" />
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1.5">
                      <label for="onboarding-accountPassword" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.PASSWORD' | translate }} <span aria-hidden="true">*</span></label>
                      <input id="onboarding-accountPassword" type="password" [(ngModel)]="accountPassword" [placeholder]="'AUTH.PASSWORD_MIN_HINT' | translate" autocomplete="new-password"
                        class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none transition-all focus:border-ortho-sky focus:ring-4 focus:ring-ortho-sky/5 text-slate-900 dark:text-white" />
                    </div>
                    <div class="space-y-1.5">
                      <label for="onboarding-accountPasswordConfirm" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.CONFIRM_PASSWORD' | translate }} <span aria-hidden="true">*</span></label>
                      <input id="onboarding-accountPasswordConfirm" type="password" [(ngModel)]="accountPasswordConfirm" [placeholder]="'AUTH.PASSWORD_REPEAT_HINT' | translate" autocomplete="new-password"
                        class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none transition-all focus:border-ortho-sky focus:ring-4 focus:ring-ortho-sky/5 text-slate-900 dark:text-white" />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Nav controls -->
              <div class="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex justify-between shrink-0">
                <button type="button" (click)="prevStep()"
                  class="px-5 py-3 border border-slate-200 dark:border-slate-800 text-slate-500 rounded-xl text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-900 transition-all active:scale-[0.98]">
                  {{ 'COMMON.BACK' | translate }}
                </button>
                <button type="button" (click)="validateAccountStep() && nextStep()"
                  class="btn-primary px-6 py-3 bg-petrol-600 hover:bg-petrol-700 text-white font-bold rounded-xl flex items-center gap-2 transition-all active:scale-[0.98]">
                  {{ 'ONBOARDING.UI.CONTINUE' | translate }}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </button>
              </div>
            </div>
          }

          <!-- STEP 3: Cabinet Name & Logo Preview -->
          @if (currentStep() === 3) {
            <div class="step-container flex-1 flex flex-col justify-between overflow-hidden">
              <div class="space-y-4 overflow-y-auto pe-1">
                <div>
                  <h2 class="text-xl font-bold text-ink-900 dark:text-white tracking-tight">{{ 'ONBOARDING.UI.IDENTITY' | translate }}</h2>
                  <p class="text-xs text-slate-500 mt-0.5">{{ 'ONBOARDING.UI.IDENTITY_HINT' | translate }}</p>
                </div>

                <!-- Input fields container -->
                <div class="space-y-3.5">
                  <!-- Name of Cabinet -->
                  <div class="space-y-1.5">
                    <label for="onboarding-cabinetName" class="block text-xs font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.CABINET_NAME' | translate }} <span aria-hidden="true">*</span></label>
                    <input id="onboarding-cabinetName" 
                      type="text" 
                      [(ngModel)]="cabinetName"
                      [placeholder]="'ONBOARDING.UI.CABINET_NAME_HINT' | translate"
                      class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none transition-all focus:border-ortho-sky focus:ring-4 focus:ring-ortho-sky/5 text-slate-900 dark:text-white" 
                    />
                  </div>

                  <!-- Logo Upload with Neat Preview -->
                  <div class="space-y-1.5">
                    <label class="block text-xs font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.LOGO' | translate }}</label>
                    <div class="flex items-center gap-4 p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
                      <!-- Live Preview Thumbnail Box -->
                      <div class="relative group h-16 w-16 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center shadow-inner shrink-0">
                        @if (logoPreview()) {
                          <img [src]="logoPreview()" [alt]="'ONBOARDING.UI.LOGO' | translate" class="h-full w-full object-contain" />
                          <button 
                            (click)="removeLogo()" 
                            [attr.aria-label]="'COMMON.DELETE' | translate"
                            type="button"
                            class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                          </button>
                        } @else {
                          <span class="text-[10px] text-slate-500 font-bold truncate px-1">
                            {{ cabinetName() ? cabinetName().charAt(0).toUpperCase() : 'Logo' }}
                          </span>
                        }
                      </div>

                      <div class="flex-1 text-left space-y-1">
                        <p class="text-xs font-semibold text-slate-700 dark:text-slate-300">{{ 'ONBOARDING.UI.UPLOAD_LOGO' | translate }}</p>
                        <p class="text-[10px] text-slate-500">{{ 'ONBOARDING.UI.LOGO_FORMATS' | translate }}</p>
                        <div class="pt-0.5">
                          <label class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold transition-all">
                            {{ 'ONBOARDING.UI.BROWSE' | translate }}
                            <input 
                              type="file" 
                              accept="image/*" 
                              class="hidden" 
                              (change)="onFileSelected($event)" 
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Nav controls -->
              <div class="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex justify-between shrink-0">
                <button 
                  type="button" 
                  (click)="prevStep()"
                  class="px-5 py-3 border border-slate-200 dark:border-slate-800 text-slate-500 rounded-xl text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-900 transition-all active:scale-[0.98]"
                >
                  {{ 'COMMON.BACK' | translate }}
                </button>
                <button 
                  type="button" 
                  (click)="nextStep()"
                  [disabled]="!cabinetName().trim()"
                  class="btn-primary px-6 py-3 bg-petrol-600 hover:bg-petrol-700 text-white font-bold rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none transition-all active:scale-[0.98]"
                >
                  {{ 'ONBOARDING.UI.NEXT' | translate }}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </button>
              </div>
            </div>
          }

          <!-- STEP 4: Enterprise Details (ICE, VAT, address, RIB, tel) -->
          @if (currentStep() === 4) {
            <div class="step-container flex-1 flex flex-col justify-between overflow-hidden">
              <div class="space-y-4 overflow-y-auto pe-1">
                <div>
                  <div class="flex justify-between items-center">
                    <h2 class="text-xl font-bold text-ink-900 dark:text-white tracking-tight">{{ 'ONBOARDING.UI.ENTERPRISE' | translate }}</h2>
                    <span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{{ 'COMMON.OPTIONAL' | translate }}</span>
                  </div>
                  <p class="text-xs text-slate-500 mt-0.5">{{ 'ONBOARDING.UI.ENTERPRISE_HINT' | translate }}</p>
                </div>

                <div class="grid grid-cols-2 gap-3 py-1">
                  <!-- ICE -->
                  <div class="space-y-1">
                    <label for="onboarding-ice" class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.ICE' | translate }}</label>
                    <input id="onboarding-ice" 
                      type="text" 
                      [(ngModel)]="ice"
                      placeholder="001234567..."
                      class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs outline-none transition-all focus:border-ortho-sky text-slate-800 dark:text-white font-mono" 
                    />
                  </div>

                  <!-- VAT -->
                  <div class="space-y-1">
                    <label for="onboarding-vat" class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.VAT' | translate }}</label>
                    <input id="onboarding-vat" 
                      type="text" 
                      [(ngModel)]="vat"
                      placeholder="MA-98765"
                      class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs outline-none transition-all focus:border-ortho-sky text-slate-800 dark:text-white font-mono" 
                    />
                  </div>

                  <!-- Patente -->
                  <div class="space-y-1">
                    <label for="onboarding-patente" class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.PATENTE' | translate }}</label>
                    <input id="onboarding-patente" 
                      type="text" 
                      [(ngModel)]="patente"
                      placeholder="34567890"
                      class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs outline-none transition-all focus:border-ortho-sky text-slate-800 dark:text-white font-mono" 
                    />
                  </div>

                  <!-- Tel -->
                  <div class="space-y-1">
                    <label for="onboarding-tel" class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.PHONE' | translate }}</label>
                    <input id="onboarding-tel" 
                      type="tel" 
                      [(ngModel)]="tel"
                      placeholder="+212 522-000000"
                      class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs outline-none transition-all focus:border-ortho-sky text-slate-800 dark:text-white" 
                    />
                  </div>

                  <!-- Address -->
                  <div class="col-span-2 space-y-1">
                    <label for="onboarding-address" class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.ADDRESS' | translate }}</label>
                    <input id="onboarding-address" 
                      type="text" 
                      [(ngModel)]="address"
                      [placeholder]="'ONBOARDING.UI.ADDRESS_HINT' | translate"
                      class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs outline-none transition-all focus:border-ortho-sky text-slate-800 dark:text-white" 
                    />
                  </div>

                  <!-- RIB -->
                  <div class="col-span-2 space-y-1">
                    <label for="onboarding-rib" class="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">{{ 'ONBOARDING.UI.RIB' | translate }}</label>
                    <input id="onboarding-rib" 
                      type="text" 
                      [(ngModel)]="rib"
                      [placeholder]="'ONBOARDING.UI.RIB_HINT' | translate"
                      class="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs outline-none transition-all focus:border-ortho-sky text-slate-800 dark:text-white text-center font-mono" 
                    />
                  </div>
                </div>
              </div>

              <!-- Nav controls -->
              <div class="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex justify-between shrink-0">
                <button 
                  type="button" 
                  (click)="prevStep()"
                  class="px-5 py-3 border border-slate-200 dark:border-slate-800 text-slate-500 rounded-xl text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-900 transition-all active:scale-[0.98]"
                >
                  {{ 'COMMON.BACK' | translate }}
                </button>
                <button
                  type="button"
                  (click)="submitOnboarding()"
                  [disabled]="submitting()"
                  class="px-6 py-3 bg-ortho-teal hover:bg-ortho-teal/90 text-white font-bold rounded-xl flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
                >
                  {{ (submitting() ? 'ONBOARDING.UI.SETTING_UP' : 'ONBOARDING.UI.COMPLETE') | translate }}
                  @if (!submitting()) {
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  }
                </button>
              </div>
              @if (accountError()) {
                <p class="text-xs text-red-700 text-center pt-2">{{ accountError() }}</p>
              }
            </div>
          }

        </div>
      </div>

      <!-- Footer indicator dots -->
      <footer class="flex items-center gap-2 py-4 shrink-0 z-10">
        @for (dot of [0, 1, 2, 3, 4]; track dot) {
          <div 
            [ngClass]="{
              'bg-petrol-600 w-4': currentStep() === dot,
              'bg-slate-300 dark:bg-slate-700 w-1.5': currentStep() !== dot
            }"
            class="h-1.5 rounded-full transition-all duration-300"
          ></div>
        }
      </footer>

      <!-- Full-screen celebration overlay (Strictly viewport sized) -->
      @if (showCelebration()) {
        <div class="fixed inset-0 z-50 bg-[rgb(var(--ink-50))]/90 dark:bg-slate-950/90 backdrop-blur-md flex flex-col justify-center items-center text-slate-800 dark:text-slate-100 p-6 animation-fade-in h-screen w-screen overflow-hidden select-none">
          <div class="text-center p-4 max-w-sm space-y-6 scale-up-bounce flex flex-col items-center">
            <div class="h-16 w-16 rounded-full bg-ortho-teal/10 dark:bg-ortho-teal/20 border border-ortho-teal/20 dark:border-ortho-teal/40 text-3xl flex items-center justify-center float-gentle mb-2 shadow-sm">
              🎉
            </div>
            
            <div class="space-y-2">
              <h2 class="text-2xl font-extrabold tracking-tight text-ink-900 dark:text-white">{{ 'ONBOARDING.UI.DONE' | translate }}</h2>
              <p class="text-xs text-slate-500 dark:text-slate-500 leading-relaxed px-4">
                {{ 'ONBOARDING.UI.DONE_HINT' | translate }}
              </p>
            </div>

            <div class="pt-4 flex flex-col items-center gap-3">
              <div class="h-6 w-6 animate-spin rounded-full border-2 border-solid border-petrol-600 dark:border-ortho-sky border-r-transparent" role="status"></div>
              <span class="text-[10px] text-slate-500 dark:text-slate-500 tracking-wider uppercase">{{ 'ONBOARDING.UI.LOADING' | translate }}</span>
            </div>
          </div>
        </div>
      }

    </main>
  `,
  styles: [`
    :host { display: block; }

    .step-container {
      animation: slideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    /* Slick welcome texts animations */
    .welcome-hello {
      animation: helloScale 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }
    
    .welcome-sub {
      opacity: 0;
      animation: subFadeIn 0.8s ease-out 0.4s forwards;
    }

    .animation-fade-in {
      animation: fadeIn 0.3s ease-out forwards;
    }
    
    .scale-up-bounce {
      animation: scaleUpBounce 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes helloScale {
      0% { transform: scale(0.85); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }

    @keyframes subFadeIn {
      0% { opacity: 0; transform: translateY(6px); }
      100% { opacity: 1; transform: translateY(0); }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleUpBounce {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
  `]
})
export class OnboardingComponent {
  private readonly translate = inject(TranslateService);
  private cabinetService = inject(CabinetService);
  private languageService = inject(LanguageService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private authApi = inject(AuthApiService);
  private authService = inject(AuthService);

  // Stepper state (0=Welcome, 1=Role, 2=Account, 3=Cabinet Branding, 4=Enterprise details)
  readonly currentStep = signal<number>(0);
  readonly showCelebration = signal<boolean>(false);
  readonly submitting = signal<boolean>(false);
  readonly accountError = signal<string | null>(null);
  readonly accountExists = signal<boolean>(false);

  // Form Fields
  readonly selectedRole = signal<'doctor' | 'assistant' | null>(null);
  readonly accountFirstName = signal<string>('');
  readonly accountLastName = signal<string>('');
  readonly accountEmail = signal<string>('');
  readonly accountPassword = signal<string>('');
  readonly accountPasswordConfirm = signal<string>('');
  readonly cabinetName = signal<string>('');
  readonly logoPreview = signal<string>('');
  readonly ice = signal<string>('');
  readonly vat = signal<string>('');
  readonly patente = signal<string>('');
  readonly address = signal<string>('');
  readonly rib = signal<string>('');
  readonly tel = signal<string>('');

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    readAndValidateLogo(input.files[0])
      .then(dataUrl => this.logoPreview.set(dataUrl))
      .catch((err: LogoValidationError) => this.toast.error(err.message))
      .finally(() => { input.value = ''; });
  }

  removeLogo(): void {
    this.logoPreview.set('');
  }

  nextStep(): void {
    this.currentStep.set(this.currentStep() + 1);
  }

  prevStep(): void {
    if (this.currentStep() > 0) {
      this.currentStep.set(this.currentStep() - 1);
    }
  }

  /**
   * Validates the account step and, if it passes, clears any previous error
   * so the Continue button's (click) handler can chain "validate && advance".
   */
  validateAccountStep(): boolean {
    this.accountError.set(null);
    if (!this.accountFirstName().trim() || !this.accountLastName().trim()) {
      this.accountError.set(this.translate.instant('ONBOARDING.UI.NAME_REQUIRED'));
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.accountEmail().trim())) {
      this.accountError.set(this.translate.instant('ONBOARDING.UI.EMAIL_INVALID'));
      return false;
    }
    if (this.accountPassword().length < 10) {
      this.accountError.set(this.translate.instant('ONBOARDING.UI.PASSWORD_SHORT'));
      return false;
    }
    if (this.accountPassword() !== this.accountPasswordConfirm()) {
      this.accountError.set(this.translate.instant('ONBOARDING.UI.PASSWORD_MISMATCH'));
      return false;
    }
    return true;
  }

  /**
   * Onboarding is the only place a new install can create its first user —
   * there was previously no registration path anywhere in the app, so a
   * fresh deployment had a cabinet-setup wizard that saved branding to
   * localStorage but never created an account capable of logging in.
   */
  submitOnboarding(): void {
    if (this.submitting()) return;
    this.accountError.set(null);
    this.accountExists.set(false);
    this.submitting.set(true);

    const role = this.selectedRole() === 'doctor' ? 'DOCTOR' : 'ASSISTANT';
    const email = this.accountEmail().trim();
    const password = this.accountPassword();

    this.authApi.register({
      email,
      password,
      firstName: this.accountFirstName().trim(),
      lastName: this.accountLastName().trim(),
      role,
    }).subscribe({
      next: () => {
        this.authService.login(email, password).subscribe({
          next: () => this.finishOnboarding(),
          error: () => {
            this.submitting.set(false);
            this.accountError.set(this.translate.instant('ONBOARDING.UI.SIGNIN_FAILED'));
            this.router.navigate(['/login']);
          }
        });
      },
      error: (err) => {
        this.submitting.set(false);
        this.accountError.set(this.describeRegisterError(err));
        this.accountExists.set(err.status === 409 || err.status === 401);
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login'], { queryParams: { email: this.accountEmail().trim() || null } });
  }

  /**
   * status 0 means the request never reached the server (backend down, wrong
   * port, CORS) — a real 409 conflict always carries a `detail` body, so
   * conflating the two here previously told users "an account already
   * exists" when the actual problem was that nothing was listening.
   */
  private describeRegisterError(err: { status?: number; error?: { detail?: string } }): string {
    if (err.status === 0) {
      return this.translate.instant('ONBOARDING.UI.SERVER_UNREACHABLE');
    }
    if (err.status === 409) {
      return err.error?.detail || this.translate.instant('ONBOARDING.UI.EMAIL_TAKEN');
    }
    if (err.status === 401) {
      // Bootstrap-only endpoint: once any account exists, unauthenticated
      // registration is rejected regardless of which email was submitted.
      return this.translate.instant('ONBOARDING.UI.WORKSPACE_TAKEN');
    }
    return err.error?.detail || this.translate.instant('ONBOARDING.UI.CREATE_FAILED');
  }

  private finishOnboarding(): void {
    const info: CabinetInfo = {
      name: this.cabinetName().trim(),
      logoUrl: this.logoPreview() || undefined,
      role: this.selectedRole() || undefined,
      ice: this.ice().trim() || undefined,
      vat: this.vat().trim() || undefined,
      patente: this.patente().trim() || undefined,
      address: this.address().trim() || undefined,
      rib: this.rib().trim() || undefined,
      tel: this.tel().trim() || undefined,
    };

    this.cabinetService.saveCabinetInfo(info);
    this.submitting.set(false);
    this.showCelebration.set(true);

    setTimeout(() => {
      this.router.navigate(['/']);
    }, 2500);
  }

  isLang(lang: string): boolean {
    return this.languageService.currentLang() === lang;
  }

  changeLang(lang: string): void {
    // Route through LanguageService (not translateService.use directly) so
    // choosing Arabic here actually switches document.dir to RTL and
    // persists the choice — previously it silently reverted on next load
    // (audit VIII.12 / XI.2).
    this.languageService.setLanguage(lang);
  }
}
