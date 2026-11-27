// Set VITE_API_URL (your Apps Script web-app URL) and VITE_PUBLIC_URL in a .env file before building.
export const API_URL = import.meta.env.VITE_API_URL || '';
export const PREVIEW = !import.meta.env.VITE_API_URL;
const base = (import.meta.env.VITE_PUBLIC_URL || (location.origin + location.pathname.replace(/[^/]*$/, ''))).replace(/\/+$/, '');
export const PUBLIC_URL = base;
export const claimUrl = (kind, token) => `${PUBLIC_URL}/?c=${kind === 'ONLINE' ? 'online' : 'store'}&t=${token}`;

export const BRAND = {
  name: 'MK Jewels',
  website: 'https://www.mkjewels.in',
  whatsapp: '919819672000',
  instagram: 'https://www.instagram.com/mkjewels_india'
};
