// The parity environment: the feature/denteam-parity branch deployed beside
// production (see docker-compose.parity.yml in orthoflow-backend). The API URL
// is baked in at build time, so it needs its own build configuration.
export const environment = {
  production: true,
  apiUrl: 'https://apiorthoflow.bento212.com'
};
