import { Routes } from '@angular/router';
import { MenuComponent } from './pages/menu.component';

export const routes: Routes = [
  { path: '', component: MenuComponent },
  { path: 'host', loadComponent: () => import('./pages/host.component').then((m) => m.HostComponent) },
  { path: 'join', loadComponent: () => import('./pages/join.component').then((m) => m.JoinComponent) },
  { path: 'join/:code', loadComponent: () => import('./pages/join.component').then((m) => m.JoinComponent) },
  { path: 'play', loadComponent: () => import('./pages/game.component').then((m) => m.GameComponent) },
  { path: '**', redirectTo: '' },
];
