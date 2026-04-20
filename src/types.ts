/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface InventoryItem {
  serial: string;
  model: string;
  user: string;
  user_name?: string;
  city: string;
  auditedAt?: string;
  status: 'pending' | 'audited' | 'error_location';
}

export interface ScanLogEntry {
  id: string;
  timestamp: string;
  serial: string;
  result: 'success' | 'wrong_city' | 'not_found' | 'already_audited';
  details: string;
  model?: string;
  user?: string;
  user_name?: string;
}

export interface CityStats {
  total: number;
  audited: number;
  pending: number;
}
