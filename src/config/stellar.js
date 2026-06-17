// Configuration for Stellar Horizon URLs per network.
// Allows dynamic selection via STELLAR_NETWORK env variable.
// Extend as needed for additional networks.

const HORIZON_URLS = {
  mainnet: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
};

module.exports = { HORIZON_URLS };
