/**
 * Date and time utilities
 */

/**
 * Get current timestamp in ISO format
 * @returns {string}
 */
export const getCurrentTimestamp = () => {
  return new Date().toISOString();
};

/**
 * Format date to readable string
 * @param {Date|string} date - Date to format
 * @param {string} locale - Locale (default: 'en-US')
 * @returns {string}
 */
export const formatDate = (date: Date | string, locale = 'en-US') => {
  const d = new Date(date);
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

/**
 * Format timestamp to readable string with time
 * @param {Date|string} date - Date to format
 * @param {string} locale - Locale (default: 'en-US')
 * @returns {string}
 */
export const formatDateTime = (date: Date | string, locale = 'en-US') => {
  const d = new Date(date);
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Get time difference in human-readable format
 * @param {Date|string} date - Date to compare
 * @returns {string}
 */
export const getTimeAgo = (date: Date | string) => {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);

  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };

  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
    }
  }

  return 'just now';
};

/**
 * Calculate duration between two dates
 * @param {Date|string} start - Start date
 * @param {Date|string} end - End date
 * @returns {Object} - {days, hours, minutes, seconds}
 */
export const calculateDuration = (start: Date | string, end: Date | string) => {
  const diff = new Date(end).getTime() - new Date(start).getTime();

  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
    milliseconds: diff,
  };
};

/**
 * Check if date is valid
 * @param {any} date - Date to check
 * @returns {boolean}
 */
export const isValidDate = (date: unknown) => {
  const d = new Date(date as string);
  return d instanceof Date && !isNaN(d.getTime());
};
