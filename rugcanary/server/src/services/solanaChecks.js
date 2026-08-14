const { PublicKey } = require('@solana/web3.js');
const { getConnection } = require('./solanaConnection');

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Parses a user-supplied string as a Solana address. Returns the
 * PublicKey or throws — callers turn the throw into a 400 response.
 */
function parseMintAddress(rawAddress) {
  if (typeof rawAddress !== 'string' || rawAddress.trim().length === 0) {
    throw new Error('Token address is required');
  }
  const trimmed = rawAddress.trim();
  try {
    return new PublicKey(trimmed);
  } catch {
    throw new Error('Not a valid Solana address');
  }
}

/**
 * Fetches the mint account once and reads both mint authority and freeze
 * authority off it — one RPC round trip covers both checks.
 */
async function checkMintAndFreezeAuthority(mintPubkey) {
  const connection = getConnection();
  const accountInfo = await connection.getParsedAccountInfo(mintPubkey);

  const owner = accountInfo?.value?.owner?.toString();
  if (!accountInfo?.value || (owner !== TOKEN_PROGRAM_ID && owner !== TOKEN_2022_PROGRAM_ID)) {
    throw new Error('Address is not an SPL token mint');
  }

  const parsed = accountInfo.value.data?.parsed?.info;
  if (!parsed) {
    throw new Error('Could not read mint data for this address');
  }

  const mintAuthority = parsed.mintAuthority ?? null;
  const freezeAuthority = parsed.freezeAuthority ?? null;

  return {
    mintAuthority: {
      id: 'mintAuthority',
      label: 'Mint authority',
      pass: mintAuthority === null,
      detail:
        mintAuthority === null
          ? 'Revoked — supply is fixed, no one can mint new tokens.'
          : `Still active (${mintAuthority}) — this address can mint unlimited new tokens.`,
      value: mintAuthority,
    },
    freezeAuthority: {
      id: 'freezeAuthority',
      label: 'Freeze authority',
      pass: freezeAuthority === null,
      detail:
        freezeAuthority === null
          ? 'Revoked — no one can freeze holder wallets.'
          : `Still active (${freezeAuthority}) — this address can freeze any holder's tokens.`,
      value: freezeAuthority,
    },
    tokenProgram: owner === TOKEN_2022_PROGRAM_ID ? 'token-2022' : 'spl-token',
    decimals: parsed.decimals,
    supply: parsed.supply,
  };
}

module.exports = {
  parseMintAddress,
  checkMintAndFreezeAuthority,
};
