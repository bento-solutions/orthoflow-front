import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { ScheduleService } from '../../core/services/schedule.service';
import { PatientService } from '../../core/services/patient.service';
import { Appointment } from '../../core/models/patient.model';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { PracticeSettingsService } from '../../core/services/practice-settings.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { PermissionService } from '../../core/services/permission.service';
import { AgendaConfigService, APPOINTMENT_STATUSES, AppointmentType } from '../../core/services/agenda-config.service';
import { LiveEventsService } from '../../core/services/live-events.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type CalendarView = 'day' | 'week' | 'month' | 'year';

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, ReactiveFormsModule, FormsModule],
  template: `
    <div class="schedule-container" [class.rtl]="translate.currentLang === 'ar'">
      <header class="schedule-header">
        <div class="header-left">
          <h1>{{ 'SCHEDULE.TITLE' | translate }}</h1>
          <div class="view-switcher">
            <button type="button" [class.active]="view() === 'day'" (click)="view.set('day')">{{ 'SCHEDULE.DAY' | translate }}</button>
            <button type="button" [class.active]="view() === 'week'" (click)="view.set('week')">{{ 'SCHEDULE.WEEK' | translate }}</button>
            <button type="button" [class.active]="view() === 'month'" (click)="view.set('month')">{{ 'SCHEDULE.MONTH' | translate }}</button>
            <button type="button" [class.active]="view() === 'year'" (click)="view.set('year')">{{ 'SCHEDULE.YEAR' | translate }}</button>
          </div>
        </div>

        <div class="header-right">
          <div class="date-nav">
            <button type="button" class="icon-btn" [attr.aria-label]="'SCHEDULE.PREVIOUS' | translate" (click)="navigate(-1)">
              <span class="material-icons" aria-hidden="true">chevron_left</span>
            </button>
            <span class="current-date">{{ formattedCurrentDate() }}</span>
            <button type="button" class="icon-btn" [attr.aria-label]="'SCHEDULE.NEXT' | translate" (click)="navigate(1)">
              <span class="material-icons" aria-hidden="true">chevron_right</span>
            </button>
            <button type="button" class="btn-schedule-ghost" (click)="goToToday()">{{ 'SCHEDULE.TODAY' | translate }}</button>
          </div>
          <div class="filters">
            <select class="filter-select" [attr.aria-label]="'COMMON.PRACTITIONER' | translate" [value]="practitionerFilter()" (change)="practitionerFilter.set($any($event.target).value)">
              <option value="">{{ 'COMMON.ALL_PRACTITIONERS' | translate }}</option>
              @for (p of practitioners.active(); track p.id) {
                <option [value]="p.id">{{ p.displayName }}</option>
              }
            </select>
            <div class="search-box">
              <span class="material-icons">search</span>
              <input type="text" [placeholder]="'SCHEDULE.FILTER_PLACEHOLDER' | translate" (input)="onPatientFilter($event)" />
            </div>
            <button type="button" class="btn btn-primary" (click)="openAddModal()">
              <span class="material-icons">add</span>
              {{ 'SCHEDULE.NEW_APPOINTMENT' | translate }}
            </button>
          </div>
        </div>
      </header>

      <main class="calendar-body">
        @switch (view()) {
          @case ('month') {
            <div class="month-view">
              <div class="weekday-header">
                @for (day of weekdays; track day) {
                  <div class="weekday">{{ 'SCHEDULE.WEEKDAYS.' + day | translate }}</div>
                }
              </div>
              <div class="calendar-grid">
                @for (day of calendarDays(); track day.date.toISOString()) {
                  <!-- The cell is a container, not a control. It used to be
                       role="button" wrapping the event pills, which are
                       buttons too — an interactive element inside an
                       interactive element (axe nested-interactive), so
                       screen readers could not reach the appointments
                       inside a day. The day number is now the "add on this
                       day" control, making both actions siblings. -->
                  <div
                    class="calendar-day"
                    [class.other-month]="!day.isCurrentMonth"
                    [class.today]="day.isToday"
                    (click)="openAddModal(day.date)"
                  >
                    <button
                      type="button"
                      class="day-number"
                      [attr.aria-label]="('SCHEDULE.ADD_APPOINTMENT_ON' | translate: { date: day.date.toDateString() })"
                      (click)="openAddModal(day.date); $event.stopPropagation()"
                    >{{ day.date.getDate() }}</button>
                    <div class="day-events">
                      @for (event of day.events; track event.id) {
                        <button
                          type="button"
                          class="event-pill"
                          [class]="'event-pill ' + event.type.toLowerCase()"
                          [style.box-shadow]="barShadow(event)"
                          [attr.title]="eventTitle(event)"
                          [attr.aria-label]="('SCHEDULE.VIEW_APPOINTMENT' | translate: { patient: getPatientName(event.patientId), time: formatTime(event.dateTime) })"
                          (click)="openEditModal(event); $event.stopPropagation()"
                        >
                          <span class="event-time">{{ formatTime(event.dateTime) }}</span>
                          <span class="event-patient">{{ getPatientName(event.patientId) }}</span>
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
          @case ('week') {
            <div class="week-view">
              <div class="week-header-row">
                <div class="time-gutter"></div>
                @for (day of weekDays(); track day.date.toISOString()) {
                  <div class="week-day-header" [class.today]="day.isToday">
                    <span class="week-day-name">{{ 'SCHEDULE.WEEKDAYS.' + weekdays[day.date.getDay()] | translate }}</span>
                    <span class="week-day-number">{{ day.date.getDate() }}</span>
                  </div>
                }
              </div>
              <div class="week-body">
                <div class="time-column">
                  @for (hour of hours(); track hour) {
                    <div class="time-slot">{{ hour }}:00</div>
                  }
                </div>
                @for (day of weekDays(); track day.date.toISOString()) {
                  <div class="week-day-column" [class.today]="day.isToday">
                    @for (hour of hours(); track hour) {
                      <div
                        class="hour-row"
                        (click)="openAddModalWithTime(hour, day.date)"
                        (dragover)="onDragOver($event)"
                        (drop)="onDrop($event, day.date, hour)"
                      ></div>
                    }
                    @for (event of day.events; track event.id) {
                      <div
                        class="day-event-card"
                        [style.top.px]="getEventTop(event)"
                        [style.height.px]="52"
                        [style.box-shadow]="barShadow(event)"
                        [attr.title]="eventTitle(event)"
                        [class]="event.type.toLowerCase()"
                        [class.dragging]="draggingId() === event.id"
                        draggable="true"
                        tabindex="0"
                        role="button"
                        [attr.aria-label]="('SCHEDULE.VIEW_APPOINTMENT' | translate: { patient: getPatientName(event.patientId), time: formatTime(event.dateTime) })"
                        (dragstart)="onDragStart($event, event)"
                        (dragend)="draggingId.set(null)"
                        (click)="openEditModal(event); $event.stopPropagation()"
                        (keydown.enter)="openEditModal(event); $event.stopPropagation()"
                        (keydown.space)="$event.preventDefault(); openEditModal(event); $event.stopPropagation()"
                      >
                        <div class="card-time">{{ formatTime(event.dateTime) }}</div>
                        <span class="patient">{{ getPatientName(event.patientId) }}</span>
                        @if (event.chairName) {
                          <span class="chair-tag">{{ event.chairName }}</span>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }
          @case ('day') {
            <div class="day-view">
              <div class="time-column">
                @for (hour of hours(); track hour) {
                  <div class="time-slot">{{ hour }}:00</div>
                }
              </div>
              <div
                class="events-column"
                (dragover)="onDragOver($event)"
                (drop)="onDrop($event, currentDate(), null)"
              >
                @for (hour of hours(); track hour) {
                  <div class="hour-row" (click)="openAddModalWithTime(hour)"></div>
                }
                @for (event of dayEvents(); track event.id) {
                  <div
                    class="day-event-card"
                    [style.top.px]="getEventTop(event)"
                    [style.height.px]="60"
                    [style.box-shadow]="barShadow(event)"
                    [attr.title]="eventTitle(event)"
                    [class]="event.type.toLowerCase()"
                    [class.dragging]="draggingId() === event.id"
                    draggable="true"
                    tabindex="0"
                    role="button"
                    [attr.aria-label]="('SCHEDULE.VIEW_APPOINTMENT' | translate: { patient: getPatientName(event.patientId), time: formatTime(event.dateTime) })"
                    (dragstart)="onDragStart($event, event)"
                    (dragend)="draggingId.set(null)"
                    (click)="openEditModal(event)"
                    (keydown.enter)="openEditModal(event)"
                    (keydown.space)="$event.preventDefault(); openEditModal(event)"
                  >
                    <div class="card-time">{{ formatTime(event.dateTime) }}</div>
                    <div class="card-content">
                      <span class="patient">{{ getPatientName(event.patientId) }}</span>
                      <span class="type">{{ 'SCHEDULE.TYPES.' + event.type.toUpperCase() | translate }}</span>
                      @if (event.chairName) {
                        <span class="chair-tag">{{ event.chairName }}</span>
                      }
                      @if (event.notes) {
                        <p class="notes">{{ event.notes }}</p>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
          @case ('year') {
             <div class="year-view">
                @for (month of yearMonths; track month.index) {
                  <div class="year-month-card">
                    <h3>{{ month.date | date:'MMMM':undefined:translate.currentLang }}</h3>
                    <div class="mini-grid">
                      @for (d of month.days; track d) {
                        <div class="mini-day" [class.has-event]="monthHasEvent(month.index, d)">
                          {{ d }}
                        </div>
                      }
                    </div>
                  </div>
                }
             </div>
          }
        }
      </main>

      <!-- Appointment Modal -->
      @if (showModal()) {
        <div class="modal-overlay" (click)="closeModal()">
          <div class="modal-content" (click)="$event.stopPropagation()">
            <header class="modal-header">
              <h2>{{ (editingAppointment() ? 'SCHEDULE.FORM.TITLE_EDIT' : 'SCHEDULE.FORM.TITLE_ADD') | translate }}</h2>
              <button type="button" class="icon-btn" [attr.aria-label]="'SCHEDULE.CLOSE' | translate" (click)="closeModal()">
                <span class="material-icons" aria-hidden="true">close</span>
              </button>
            </header>
            
            <form [formGroup]="appointmentForm" (ngSubmit)="saveAppointment()">
              <div class="form-group">
                <label>{{ 'SCHEDULE.FORM.PATIENT' | translate }}</label>
                <select formControlName="patientId">
                  <option value="">{{ 'SCHEDULE.FORM.SELECT_PATIENT' | translate }}</option>
                  @for (p of patientService.patients(); track p.id) {
                    <option [value]="p.id">{{ p.firstName }} {{ p.lastName }}</option>
                  }
                </select>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>{{ 'SCHEDULE.FORM.DATE_TIME' | translate }}</label>
                  <input type="datetime-local" formControlName="dateTime">
                </div>
                <div class="form-group">
                  <label>{{ 'COMMON.PRACTITIONER' | translate }}</label>
                  <select formControlName="practitionerId">
                    <option value="">{{ 'SCHEDULE.FORM.NO_PRACTITIONER' | translate }}</option>
                    @for (p of practitioners.active(); track p.id) {
                      <option [value]="p.id">{{ p.displayName }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>{{ 'SCHEDULE.FORM.TYPE' | translate }}</label>
                  <select formControlName="appointmentTypeId" (change)="onTypeChange()">
                    <option value="">—</option>
                    @for (type of config.types(); track type.id) {
                      <option [value]="type.id">{{ config.label(type) }}</option>
                    }
                  </select>
                </div>
                <div class="form-group">
                  <label>{{ 'SCHEDULE.FORM.STATUS' | translate }}</label>
                  <select formControlName="status">
                    @for (status of appointmentStatuses; track status) {
                      <option [value]="status">{{ 'SCHEDULE.STATUS.' + status | translate }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label>{{ 'SCHEDULE.FORM.CHAIR' | translate }}</label>
                  <select formControlName="chairId">
                    <option value="">{{ 'SCHEDULE.FORM.NO_CHAIR' | translate }}</option>
                    @for (chair of scheduleService.chairs(); track chair.id) {
                      <option [value]="chair.id">{{ chair.name }}</option>
                    }
                  </select>
                </div>
                <div class="form-group">
                  <label>{{ 'SCHEDULE.FORM.DURATION_MINUTES' | translate }}</label>
                  <input type="number" min="5" step="5" formControlName="durationMinutes">
                </div>
              </div>

              <div class="form-group">
                <label>{{ 'SCHEDULE.FORM.APPLIANCE_STEP' | translate }}</label>
                <input type="number" formControlName="applianceStep">
              </div>

              <div class="form-group">
                <label>{{ 'SCHEDULE.FORM.NOTES' | translate }}</label>
                <textarea formControlName="notes" rows="3"></textarea>
              </div>

              <footer class="modal-footer">
                @if (editingAppointment()) {
                  <button type="button" class="btn btn-danger" (click)="deleteAppointment()">
                    <span class="material-icons">delete</span>
                    {{ 'COMMON.DELETE' | translate }}
                  </button>
                }
                <div class="footer-right">
                  <button type="button" class="btn-schedule-ghost" (click)="closeModal()">{{ 'COMMON.CANCEL' | translate }}</button>
                  <button type="submit" class="btn btn-primary" [disabled]="appointmentForm.invalid">
                    {{ 'COMMON.SAVE' | translate }}
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .schedule-container {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 120px);
      background: var(--surface);
      border-radius: 20px;
      border: 1px solid var(--border);
      box-shadow: 0 10px 25px rgba(0,0,0,0.05);
      overflow: hidden;
      position: relative;
    }

    .rtl { direction: rtl; }

    .schedule-header {
      padding: 1.5rem 2rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 2rem;
    }

    .header-left h1 {
      margin: 0 0 1rem 0;
      font-size: 1.5rem;
    }

    .view-switcher {
      display: flex;
      background: rgb(var(--ink-100));
      padding: 0.25rem;
      border-radius: 10px;
    }

    .view-switcher button {
      border: none;
      background: transparent;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      /* Sits on a tinted track, where --text-muted would be 4.17:1. */
      color: var(--text-muted-on-tint);
      cursor: pointer;
      transition: all 0.2s;
    }

    .view-switcher button.active {
      background: var(--surface);
      color: var(--action-text);
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }

    .header-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 1rem;
    }

    .date-nav {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .current-date {
      font-weight: 700;
      font-size: 1.1rem;
      min-width: 150px;
      text-align: center;
    }

    .filters {
      display: flex;
      gap: 1rem;
    }

    .filter-select {
      background: rgb(var(--ink-50));
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.5rem 0.75rem;
      font-size: 0.9rem;
      color: var(--text);
      max-width: 12rem;
    }

    .search-box {
      position: relative;
      background: rgb(var(--ink-50));
      border: 1px solid var(--border);
      border-radius: 10px;
      display: flex;
      align-items: center;
      padding: 0 0.75rem;
    }

    .search-box input {
      border: none;
      background: transparent;
      padding: 0.5rem;
      outline: none;
      font-size: 0.9rem;
    }

    .search-box .material-icons { font-size: 1.2rem; color: rgb(var(--ink-500)); }

    .calendar-body {
      flex: 1;
      overflow: auto;
    }

    /* Month View */
    .month-view {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .weekday-header {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      background: rgb(var(--ink-50));
      border-bottom: 1px solid var(--border);
    }

    .weekday {
      padding: 0.75rem;
      text-align: center;
      font-size: 0.75rem;
      font-weight: 700;
      color: rgb(var(--ink-500));
      text-transform: uppercase;
    }

    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      grid-auto-rows: 1fr;
      flex: 1;
    }

    .calendar-day {
      border-inline-end: 1px solid rgb(var(--ink-100));
      border-bottom: 1px solid rgb(var(--ink-100));
      padding: 0.5rem;
      min-height: 120px;
      transition: background 0.2s;
      cursor: pointer;
    }

    .calendar-day:hover { background: rgb(var(--ink-50)); }
    /* Adjacent-month cells are de-emphasised by tint, not by a blanket
       opacity: halving the alpha dropped the date numerals to 1.92:1,
       which is unreadable. The tinted ground plus a muted (but AA) numeral
       gives the same "not this month" reading at 4.87:1. */
    .calendar-day.other-month { background: rgb(var(--ink-100)); }
    .calendar-day.other-month .day-number { color: var(--text-muted-on-tint); }
    .calendar-day.other-month .event-pill { opacity: 0.75; }
    .calendar-day.today { background: rgb(var(--petrol-50)); }
    .calendar-day.today .day-number {
      background: var(--action);
      color: white;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
    }

    .day-number {
      border: 0;
      background: none;
      padding: 0;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      color: rgb(var(--ink-800));
      margin-bottom: 0.5rem;
      display: inline-block;
    }

    .day-events {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .event-pill {
      /* now a <button>; reset the UA styles it brings with it */
      border: 0;
      cursor: pointer;
      font-family: inherit;
      text-align: start;
      width: 100%;
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      gap: 0.25rem;
      font-weight: 600;
      transition: transform var(--dur-1) var(--ease-out);
    }
    .event-pill:hover { transform: scale(1.02); }

    .event-pill.checkup { background: var(--status-active-tint); color: var(--status-active-text); }
    .event-pill.initial { background: rgb(var(--positive-100)); color: rgb(var(--positive-700)); }
    .event-pill.emergency { background: rgb(var(--critical-100)); color: rgb(var(--critical-700)); }
    .event-pill.consultation { background: rgb(var(--ink-100)); color: rgb(var(--ink-700)); }
    .event-pill.braces_fit { background: rgb(var(--ink-100)); color: rgb(var(--ink-700)); }
    .event-pill.aligner_fit { background: rgb(var(--ink-100)); color: rgb(var(--ink-700)); }
    .event-pill.retainer { background: rgb(var(--positive-100)); color: rgb(var(--positive-700)); }

    /* Day View */
    .day-view {
      display: flex;
      height: 100%;
    }

    .time-column {
      width: 80px;
      border-inline-end: 1px solid var(--border);
      background: rgb(var(--ink-50));
    }

    .time-slot {
      height: 60px;
      padding: 0.5rem;
      font-size: 0.75rem;
      color: rgb(var(--ink-500));
      text-align: end;
    }

    .events-column {
      flex: 1;
      position: relative;
      background: var(--surface);
    }

    .hour-row {
      height: 60px;
      border-bottom: 1px solid rgb(var(--ink-100));
      cursor: cell;
    }
    .hour-row:hover { background: rgb(var(--ink-50)); }

    .day-event-card {
      position: absolute;
      inset-inline-start: 10px;
      inset-inline-end: 10px;
      background: var(--surface);
      border-inline-start: 4px solid var(--action);
      border-radius: 8px;
      padding: 0.5rem 1rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      display: flex;
      gap: 1rem;
      z-index: 1;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .day-event-card:hover { transform: translateY(-2px); }

    .day-event-card.checkup { border-inline-start-color: var(--action); background: rgb(var(--petrol-50)); }
    .day-event-card.emergency { border-inline-start-color: rgb(var(--critical-500)); background: rgb(var(--critical-50)); }
    .day-event-card.dragging { opacity: 0.4; }

    .card-time { font-weight: 700; color: rgb(var(--petrol-900)); font-size: 0.9rem; }
    .card-content .patient { display: block; font-weight: 700; color: rgb(var(--ink-900)); }
    .card-content .type { font-size: 0.75rem; color: rgb(var(--ink-500)); }
    .card-content .notes { font-size: 0.75rem; color: rgb(var(--ink-500)); margin: 0.25rem 0 0 0; }
    .chair-tag {
      display: inline-block;
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0.05rem 0.4rem;
      border-radius: 999px;
      background: rgb(var(--petrol-100));
      color: rgb(var(--petrol-900));
      margin-inline-start: 0.35rem;
    }

    /* Week View */
    .week-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: auto;
    }
    .week-header-row {
      display: grid;
      grid-template-columns: 80px repeat(7, 1fr);
      border-bottom: 1px solid var(--border);
      background: rgb(var(--ink-50));
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .time-gutter { border-inline-end: 1px solid var(--border); }
    .week-day-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.6rem 0;
      border-inline-end: 1px solid rgb(var(--ink-100));
    }
    .week-day-header.today { background: rgb(var(--petrol-50)); }
    .week-day-name { font-size: 0.7rem; font-weight: 600; color: rgb(var(--ink-500)); text-transform: uppercase; }
    .week-day-number { font-size: 1.1rem; font-weight: 700; color: rgb(var(--ink-900)); }
    .week-day-header.today .week-day-number { color: rgb(var(--petrol-900)); }
    .week-body {
      display: grid;
      grid-template-columns: 80px repeat(7, 1fr);
      flex: 1;
    }
    .week-day-column {
      position: relative;
      border-inline-end: 1px solid rgb(var(--ink-100));
      background: var(--surface);
    }
    .week-day-column.today { background: rgb(var(--petrol-50)); }
    .week-day-column .hour-row {
      height: 52px;
      border-bottom: 1px solid rgb(var(--ink-100));
      cursor: cell;
    }
    .week-day-column .hour-row:hover { background: rgb(var(--ink-100)); }
    .week-day-column .day-event-card {
      inset-inline-start: 4px;
      inset-inline-end: 4px;
      padding: 0.35rem 0.5rem;
      flex-direction: column;
      gap: 0.1rem;
      font-size: 0.75rem;
    }
    .week-day-column .card-time { font-size: 0.7rem; }
    .week-day-column .patient { font-weight: 700; color: rgb(var(--ink-900)); font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-content {
      background: var(--surface);
      width: 100%;
      max-width: 500px;
      border-radius: 20px;
      padding: 2rem;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }

    .modal-header h2 { margin: 0; font-size: 1.25rem; }

    .form-group { margin-bottom: 1.5rem; }
    .form-group label { display: block; margin-bottom: 0.5rem; font-weight: 600; font-size: 0.9rem; color: rgb(var(--ink-500)); }
    .form-group input, .form-group select, .form-group textarea {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      outline: none;
      font-size: 0.95rem;
    }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }

    .modal-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border);
    }

    .footer-right { display: flex; gap: 1rem; }

    /* Year View */
    .year-view {
      padding: 2rem;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 2rem;
    }

    .year-month-card h3 { font-size: 1rem; margin-bottom: 1rem; }
    .mini-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }
    .mini-day {
      font-size: 0.6rem;
      padding: 2px;
      text-align: center;
      color: rgb(var(--ink-500));
    }
    .mini-day.has-event {
      background: var(--action);
      color: white;
      border-radius: 2px;
    }




    .calendar-day:focus-visible,
    .event-pill:focus-visible,
    .day-event-card:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: -2px;
    }

    /* Named distinctly from the shared .btn-ghost (which this doesn't
       match: it keeps a visible border) so it doesn't shadow the
       canonical class. */
    .btn-schedule-ghost {
      background: transparent;
      border: 1px solid var(--border);
      padding: 0.5rem 1rem;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      color: rgb(var(--ink-500));
      cursor: pointer;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .schedule-header {
        flex-direction: column;
        padding: 1rem;
      }
      .header-right {
        align-items: center;
        width: 100%;
      }
      .filters {
        width: 100%;
        flex-direction: column;
      }
      .search-box { width: 100%; }
      .btn-primary { width: 100%; justify-content: center; }
      .calendar-grid { grid-template-columns: repeat(1, 1fr); }
      .weekday-header { display: none; }
      .calendar-day { min-height: auto; }
    }
  `]
})
export class ScheduleComponent {
  scheduleService = inject(ScheduleService);
  private toast = inject(ToastService);
  private confirmDialog = inject(ConfirmDialogService);
  private practiceSettings = inject(PracticeSettingsService);
  patientService = inject(PatientService);
  practitioners = inject(PractitionerService);
  config = inject(AgendaConfigService);
  private permissions = inject(PermissionService);
  private live = inject(LiveEventsService);
  practitionerFilter = signal('');
  translate = inject(TranslateService);
  fb = inject(FormBuilder);

  view = signal<CalendarView>('month');
  currentDate = signal(new Date());
  showModal = signal(false);
  editingAppointment = signal<Appointment | null>(null);
  draggingId = signal<string | null>(null);
  patientFilterTerm = signal('');

  appointmentForm: FormGroup;
  appointmentStatuses = APPOINTMENT_STATUSES;

  weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  // Configurable per-clinic (audit VIII.6/P2#29) via Settings > Scheduling;
  // defaults to the old hardcoded 8 AM-7 PM until the real value loads.
  hours = computed(() => {
    const { workingHoursStart, workingHoursEnd } = this.practiceSettings.settings();
    return Array.from({ length: workingHoursEnd - workingHoursStart }, (_, i) => i + workingHoursStart);
  });

  constructor() {
    this.appointmentForm = this.fb.group({
      patientId: ['', Validators.required],
      dateTime: ['', Validators.required],
      chairId: [''],
      practitionerId: [''],
      appointmentTypeId: [''],
      durationMinutes: [30, [Validators.min(5)]],
      type: ['Checkup', Validators.required],
      status: ['SCHEDULED', Validators.required],
      notes: [''],
      applianceStep: [null]
    });

    this.practiceSettings.load().subscribe({
      error: () => {} // keep the hardcoded default hours; not worth a toast for a background preference load
    });

    // Someone at the front desk checking a patient in changes this screen too.
    this.live.of('appointment').pipe(takeUntilDestroyed()).subscribe(() => this.scheduleService.refreshAppointments());
  }

  yearMonths = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(new Date().getFullYear(), i, 1);
    const lastDay = new Date(new Date().getFullYear(), i + 1, 0).getDate();
    return {
      date: d,
      index: i,
      days: Array.from({ length: lastDay }, (_, k) => k + 1)
    };
  });

  /** Appointments filtered by the patient search box — shared by every view. */
  filteredAppointments = computed(() => {
    const term = this.patientFilterTerm().trim().toLowerCase();
    const doctor = this.practitionerFilter();
    const all = this.scheduleService.appointments().filter(app => !doctor || app.practitionerId === doctor);
    if (!term) return all;
    return all.filter(app => this.getPatientName(app.patientId).toLowerCase().includes(term));
  });

  calendarDays = computed(() => {
    const date = this.currentDate();
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const appointments = this.filteredAppointments();

    const days = [];

    // Previous month filler
    const prevMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0);
    for (let i = start.getDay(); i > 0; i--) {
      days.push({
        date: new Date(date.getFullYear(), date.getMonth() - 1, prevMonthEnd.getDate() - i + 1),
        isCurrentMonth: false,
        isToday: false,
        events: []
      });
    }

    // Current month days
    const today = new Date();
    for (let i = 1; i <= end.getDate(); i++) {
      const d = new Date(date.getFullYear(), date.getMonth(), i);
      days.push({
        date: d,
        isCurrentMonth: true,
        isToday: d.toDateString() === today.toDateString(),
        events: appointments.filter(app =>
          new Date(app.dateTime).toDateString() === d.toDateString()
        )
      });
    }

    return days;
  });

  dayEvents = computed(() => {
    return this.filteredAppointments().filter(app =>
      new Date(app.dateTime).toDateString() === this.currentDate().toDateString()
    );
  });

  /** The Sun–Sat week containing currentDate, each day pre-loaded with its events. */
  weekDays = computed(() => {
    const date = this.currentDate();
    const today = new Date();
    const appointments = this.filteredAppointments();
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay());

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      return {
        date: d,
        isToday: d.toDateString() === today.toDateString(),
        events: appointments.filter(app => new Date(app.dateTime).toDateString() === d.toDateString())
      };
    });
  });

  formattedCurrentDate = computed(() => {
    const date = this.currentDate();
    const v = this.view();
    const locale = this.translate.currentLang || 'en';

    if (v === 'day') return date.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
    if (v === 'week') {
      const week = this.weekDays();
      const start = week[0].date;
      const end = week[6].date;
      // Always include the month on both ends — Intl's day+year-only
      // pattern (no month) renders as a malformed fallback string like
      // "(day: 22)" in some browsers rather than a clean date, so the
      // same-month "16 – 22, 2026" shorthand isn't worth the risk.
      const startLabel = start.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
      const endLabel = end.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
      return `${startLabel} – ${endLabel}`;
    }
    if (v === 'month') return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    return date.getFullYear().toString();
  });

  navigate(dir: number) {
    const date = new Date(this.currentDate());
    const v = this.view();
    if (v === 'day') date.setDate(date.getDate() + dir);
    else if (v === 'week') date.setDate(date.getDate() + dir * 7);
    else if (v === 'month') date.setMonth(date.getMonth() + dir);
    else date.setFullYear(date.getFullYear() + dir);
    this.currentDate.set(date);
  }

  goToToday() {
    this.currentDate.set(new Date());
  }

  /** A bar on the leading edge in the practitioner's colour, so a column of mixed doctors reads at a glance. */
  barShadow(event: Appointment): string {
    const color = event.practitionerColor || event.typeColor;
    if (!color) return '';
    return `inset ${this.translate.currentLang === 'ar' ? '-' : ''}4px 0 0 ${color}`;
  }

  eventTitle(event: Appointment): string {
    return [event.practitionerName, event.type].filter(Boolean).join(' · ');
  }

  /** Picking a type brings its usual length, but never overwrites one the person set for an existing visit. */
  onTypeChange(): void {
    const type = this.config.types().find(t => t.id === this.appointmentForm.value.appointmentTypeId) as AppointmentType | undefined;
    if (!type) return;
    this.appointmentForm.patchValue({ type: type.nameFr });
    if (!this.editingAppointment()) {
      this.appointmentForm.patchValue({ durationMinutes: type.defaultDurationMinutes });
    }
  }

  getPatientName(id: string) {
    const p = this.patientService.patients().find(p => p.id === id);
    return p ? `${p.firstName} ${p.lastName}` : (this.translate.instant('SCHEDULE.UNKNOWN_PATIENT'));
  }

  formatTime(iso: string) {
    const locale = this.translate.currentLang || 'en';
    return new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  getEventTop(event: Appointment) {
    const date = new Date(event.dateTime);
    const hours = date.getHours() + date.getMinutes() / 60;
    return (hours - this.practiceSettings.settings().workingHoursStart) * 60; // 60px per hour
  }

  monthHasEvent(monthIndex: number, day: number) {
    const year = this.currentDate().getFullYear();
    return this.scheduleService.appointments().some(app => {
      const d = new Date(app.dateTime);
      return d.getFullYear() === year && d.getMonth() === monthIndex && d.getDate() === day;
    });
  }

  onPatientFilter(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.patientFilterTerm.set(value);
  }

  openAddModal(date?: Date) {
    this.editingAppointment.set(null);
    this.appointmentForm.reset({
      patientId: '',
      dateTime: this.formatDateForInput(date || new Date()),
      chairId: '',
      practitionerId: this.practitionerFilter() || this.permissions.practitionerId() || '',
      appointmentTypeId: '',
      durationMinutes: 30,
      type: 'Checkup',
      status: 'SCHEDULED',
      notes: '',
      applianceStep: null
    });
    this.showModal.set(true);
  }

  openAddModalWithTime(hour: number, day?: Date) {
    const date = new Date(day || this.currentDate());
    date.setHours(hour, 0, 0, 0);
    this.openAddModal(date);
  }

  // ── Drag-to-reschedule ──────────────────────────────────────────────
  // Native HTML5 drag & drop — no library needed for a single-axis (time
  // slot) drop target. dragstart stashes the appointment id in both the
  // dataTransfer payload and a signal (for the CSS "lifted" style); drop
  // reads the target day/hour from the slot the pointer released over and
  // asks the server to move it, running through the exact same conflict
  // check as a manual edit so a drag can't silently create a double-booking.

  onDragStart(event: DragEvent, appointment: Appointment): void {
    this.draggingId.set(appointment.id);
    event.dataTransfer?.setData('text/plain', appointment.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  async onDrop(event: DragEvent, day: Date, hour: number | null): Promise<void> {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain') || this.draggingId();
    this.draggingId.set(null);
    if (!id) return;

    const appointment = this.scheduleService.appointments().find(a => a.id === id);
    if (!appointment) return;

    const original = new Date(appointment.dateTime);
    const newDate = new Date(day);
    if (hour !== null) {
      newDate.setHours(hour, 0, 0, 0);
    } else {
      newDate.setHours(original.getHours(), original.getMinutes(), 0, 0);
    }
    if (newDate.getTime() === original.getTime()) return;

    const conflict = this.findConflict(appointment.patientId, newDate, appointment.id);
    if (conflict) {
      const proceed = await this.confirmDialog.confirm(
        `${this.getPatientName(appointment.patientId)} already has an appointment at ${this.formatTime(conflict.dateTime)} on this day. Reschedule anyway?`,
        { confirmLabel: 'Reschedule Anyway' }
      );
      if (!proceed) return;
    }

    this.scheduleService.updateAppointment(appointment.id, { dateTime: newDate.toISOString() }).subscribe({
      next: () => this.toast.success('Appointment rescheduled.'),
      error: (err) => {
        console.error('Error rescheduling appointment', err);
        this.toast.error(err.error?.detail || err.error?.message || 'Could not reschedule the appointment.');
      }
    });
  }

  /**
   * Client-side double-booking check for the same PATIENT (audit VIII.6 —
   * advisory, not a hard guarantee under concurrent edits: two tabs can
   * still race past this). Chair-level conflicts are a separate axis and
   * ARE enforced with a hard guarantee — a Postgres exclusion constraint
   * (V21__scheduling_resources.sql) rejects an overlapping chair booking
   * server-side even if this client-side check is bypassed or stale.
   * Flags any other non-cancelled appointment for the same patient within
   * 30 minutes of the target time.
   */
  private findConflict(patientId: string, dateTime: Date, excludeId?: string): Appointment | null {
    const THIRTY_MIN = 30 * 60 * 1000;
    return this.scheduleService.appointments().find(a => {
      if (a.id === excludeId || a.patientId !== patientId || a.status === 'CANCELLED') return false;
      return Math.abs(new Date(a.dateTime).getTime() - dateTime.getTime()) < THIRTY_MIN;
    }) || null;
  }

  openEditModal(appointment: Appointment) {
    this.editingAppointment.set(appointment);
    this.appointmentForm.patchValue({
      patientId: appointment.patientId,
      dateTime: this.formatDateForInput(new Date(appointment.dateTime)),
      chairId: appointment.chairId || '',
      practitionerId: appointment.practitionerId || '',
      appointmentTypeId: appointment.appointmentTypeId || '',
      durationMinutes: appointment.durationMinutes ?? 30,
      type: appointment.type,
      status: appointment.status,
      notes: appointment.notes,
      applianceStep: appointment.applianceStep
    });
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.editingAppointment.set(null);
  }

  async saveAppointment() {
    if (this.appointmentForm.invalid) return;

    // The <input type="datetime-local"> value ("2026-08-25T01:34", no
    // timezone/seconds) isn't a valid OffsetDateTime on the wire — Jackson
    // rejects it with a 500 (it was previously only converted correctly on
    // the drag-to-reschedule path below, never on this direct-save path).
    const data = {
      ...this.appointmentForm.value,
      dateTime: new Date(this.appointmentForm.value.dateTime).toISOString(),
      chairId: this.appointmentForm.value.chairId || null,
      practitionerId: this.appointmentForm.value.practitionerId || null,
      appointmentTypeId: this.appointmentForm.value.appointmentTypeId || null
    };
    const editing = this.editingAppointment();

    const conflict = this.findConflict(data.patientId, new Date(data.dateTime), editing?.id);
    if (conflict) {
      const proceed = await this.confirmDialog.confirm(
        `${this.getPatientName(data.patientId)} already has an appointment at ${this.formatTime(conflict.dateTime)} on this day. Schedule anyway?`,
        { confirmLabel: 'Schedule Anyway' }
      );
      if (!proceed) return;
    }

    const obs = editing
      ? this.scheduleService.updateAppointment(editing.id, data)
      : this.scheduleService.addAppointment(data);

    obs.subscribe({
      next: () => {
        this.toast.success(editing ? 'Appointment updated.' : 'Appointment scheduled.');
        this.closeModal();
      },
      error: async (err) => {
        console.error('Error saving appointment', err);
        const detail: string = err.error?.detail || err.error?.message || '';
        // A blocked slot (a doctor's leave, a closure) is a warning, not a wall: the person may know better.
        if (err.status === 409 && detail.startsWith('This slot is blocked') && !data.ignoreBlocks) {
          if (await this.confirmDialog.confirm(detail, { confirmLabel: this.translate.instant('SCHEDULE.SCHEDULE_ANYWAY') })) {
            const retry = editing
              ? this.scheduleService.updateAppointment(editing.id, { ...data, ignoreBlocks: true })
              : this.scheduleService.addAppointment({ ...data, ignoreBlocks: true });
            retry.subscribe({
              next: () => { this.toast.success(editing ? 'Appointment updated.' : 'Appointment scheduled.'); this.closeModal(); },
              error: (e) => this.toast.error(e.error?.detail || 'Could not save the appointment. Please try again.')
            });
          }
          return;
        }
        this.toast.error(detail || 'Could not save the appointment. Please try again.');
      }
    });
  }

  async deleteAppointment() {
    const app = this.editingAppointment();
    if (!app) return;

    const confirmed = await this.confirmDialog.confirm(
      this.translate.instant('COMMON.DELETE_CONFIRM') || 'Are you sure?',
      { danger: true, confirmLabel: 'Delete' }
    );
    if (confirmed) {
      this.scheduleService.deleteAppointment(app.id).subscribe({
        next: () => {
          this.toast.success('Appointment deleted.');
          this.closeModal();
        },
        error: (err) => {
          console.error('Error deleting appointment', err);
          this.toast.error('Could not delete the appointment. Please try again.');
        }
      });
    }
  }

  private formatDateForInput(date: Date): string {
    const tzoffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzoffset).toISOString().slice(0, 16);
  }
}
