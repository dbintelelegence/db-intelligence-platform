export const SEVERITY_COLORS = {
  critical: {
    bg: 'bg-red-100',
    text: 'text-red-800',
    border: 'border-red-300',
    badge: 'bg-red-500 text-white',
  },
  warning: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    border: 'border-amber-300',
    badge: 'bg-amber-500 text-white',
  },
  info: {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    border: 'border-blue-300',
    badge: 'bg-blue-500 text-white',
  },
} as const;

export const CLOUD_COLORS = {
  aws: {
    bg: 'bg-orange-100',
    text: 'text-orange-800',
    badge: 'bg-orange-500 text-white',
  },
  gcp: {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    badge: 'bg-blue-500 text-white',
  },
  azure: {
    bg: 'bg-sky-100',
    text: 'text-sky-800',
    badge: 'bg-sky-500 text-white',
  },
} as const;

export const DATABASE_TYPE_COLORS = {
  postgres: 'bg-indigo-500',
  mysql: 'bg-blue-500',
  mongodb: 'bg-green-500',
  redis: 'bg-red-500',
  dynamodb: 'bg-purple-500',
  aurora: 'bg-pink-500',
} as const;

export const ENVIRONMENT_COLORS = {
  production: {
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    badge: 'bg-purple-600 text-white',
  },
  staging: {
    bg: 'bg-yellow-100',
    text: 'text-yellow-800',
    badge: 'bg-yellow-600 text-white',
  },
  development: {
    bg: 'bg-gray-100',
    text: 'text-gray-800',
    badge: 'bg-gray-600 text-white',
  },
} as const;
