import { MAX_FILE_SIZE, DEFAULT_HOST } from '../constants/app';

export const appConfig = {
  port: 3000,
  maxFileSize: MAX_FILE_SIZE,
  host: DEFAULT_HOST,
  get nodeEnv() {
    return process.env.NODE_ENV || 'development';
  },
};
