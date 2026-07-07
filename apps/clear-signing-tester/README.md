# Clear Signing Tester

TypeScript CLI that tests Ethereum and Solana transactions using the Ledger Device Management Kit with a [Speculinho](https://ledgerhq.atlassian.net/wiki/spaces/PE/pages/7100399635)-provisioned Speculos emulator.

## How it works

The tester acquires a remote Speculos pod from Speculinho, runs signing tests against it, then releases it. No Docker, no local coin apps required.

## Prerequisites

- **Node.js** 20+

## Installation

```bash
pnpm install
pnpm build:libs
```

## Environment variables

| Variable            | Required                      | Default                             | Description             |
| ------------------- | ----------------------------- | ----------------------------------- | ----------------------- |
| `ETHERSCAN_API_KEY` | For contract commands         | —                                   | Etherscan API key       |
| `GATING_TOKEN`      | For CAL origin-gated features | —                                   | Origin token            |
| `SPECULINHO_URL`    | No                            | `https://speculinho.ledgerlabs.net` | Speculinho operator URL |

## Ethereum CLI

```
Usage: pnpm cs-tester cli [options] [command]

Options:
  --device <device>                Device type (stax, nanox, nanos, nanos+, flex, apex, default: stax)
  --app-eth-version <version>      Ethereum app version (e.g. 1.19.1). If omitted, Speculinho resolves the latest.
  --os-version <version>           Device OS version (e.g. 1.4.0). If omitted, Speculinho resolves the latest.
  --speculinho-url <url>           Speculinho operator URL (overrides SPECULINHO_URL env var)
  --derivation-path <path>         Derivation path (default: "44'/60'/0'/0/0")
  --erc7730-files <files...>       ERC7730 JSON files to inject for clear signing testing
  --screenshot-folder-path <path>  Save screenshots during transaction signing
  --log-level <level>              Console log level: none, error, warn, info, debug (default: info)
  --log-file <path>                Log output to a file
  --file-log-level <level>         File log level (requires --log-file)

Commands:
  raw-transaction <transaction>    Test a single raw transaction
  raw-file <file>                  Test multiple raw transactions from a JSON file
  typed-data <data>                Test a single typed data object (JSON string)
  typed-data-file <file>           Test multiple typed data objects from a JSON file
  contract [options] <address>     Test a contract
  contract-file [options] <file>   Test multiple contracts from a JSON file
  start-speculos                   Start the Speculos emulator and keep it running (Ctrl+C to stop)
```

### Examples

```bash
# Basic usage (Speculinho default)
pnpm cs-tester cli --device stax raw-file ressources/raw-erc20.json

# Pin specific app/OS versions
pnpm cs-tester cli \
  --device stax \
  --app-eth-version 1.19.1 \
  --os-version 1.4.0 \
  raw-file ressources/raw-erc20.json

# Override the Speculinho operator URL
pnpm cs-tester cli \
  --device stax \
  --speculinho-url https://my-speculinho.example.com \
  raw-file ressources/raw-erc20.json

# Test typed data
pnpm cs-tester cli typed-data-file ressources/typed-data-example.json

# Test a contract
pnpm cs-tester cli contract 0x9D39A5DE30e57443BfF2A8307A4256c8797A3497

# Test with custom ERC7730 descriptors (e.g. for a contract not yet in CAL)
pnpm cs-tester cli raw-transaction <tx> --erc7730-files ./descriptor.json
```

### Pre-built test cases

```bash
pnpm cs-tester test:raw:complete
pnpm cs-tester test:raw:multisig
pnpm cs-tester test:raw:erc20
pnpm cs-tester test:typed-data:multisig
```

## Solana CLI

```
Usage: pnpm cs-tester sol [options] [command]

Options:
  --device <device>                Device type (stax, nanox, nanos, nanos+, flex, apex, default: stax)
  --app-sol-version <version>      Solana app version. If omitted, Speculinho resolves the latest.
  --os-version <version>           Device OS version. If omitted, Speculinho resolves the latest.
  --speculinho-url <url>           Speculinho operator URL (overrides SPECULINHO_URL env var)
  --derivation-path <path>         Derivation path (default: "44'/501'/0'")
  --screenshot-folder-path <path>  Save screenshots during transaction signing
  --rpc-url <url>                  Solana RPC endpoint (required for program commands)
  --scan-limit <n>                 Number of recent signatures to scan (default: 500)
  --samples-per-instruction <n>    Transactions to test per instruction type (default: 1)
  --log-level <level>              Console log level (default: info)
  --log-file <path>                Log output to a file
  --file-log-level <level>         File log level (requires --log-file)
```

## ERC7730 Clear Signing Support

Inject custom ERC7730 descriptors to test contracts not yet in the production CAL:

```bash
# Single descriptor
pnpm cs-tester cli raw-transaction <tx> --erc7730-files ./descriptor.json

# Multiple descriptors
pnpm cs-tester cli raw-transaction <tx> --erc7730-files ./d1.json ./d2.json

# With typed data
pnpm cs-tester cli typed-data-file ./test-data.json --erc7730-files ./descriptor.json
```

## Logging

```bash
# Verbose console output
pnpm cs-tester cli --log-level debug raw-file ./ressources/raw-erc20.json

# Log to file with debug level
pnpm cs-tester cli --log-file ./output.log --file-log-level debug raw-file ./ressources/raw-erc20.json

# Silent console, verbose file
pnpm cs-tester cli --log-level none --log-file ./debug.log --file-log-level debug raw-file ./ressources/raw-erc20.json
```

## Screenshots

```bash
pnpm cs-tester cli --screenshot-folder-path ./screenshots raw-file ./ressources/raw-erc20.json
```

Screenshots are saved as `screenshot_1.png`, `screenshot_2.png`, etc.

## Output

### Exit codes

- **`0`**: All tests passed
- **Non-zero**: Number of failed tests

### Status types

- **✅ `clear_signed`**: Transaction/typed data was clear signed – all expected texts found on screen
- **⚠️ `partially_clear_signed`**: Signed successfully but at least one expected text was not visible
- **🙈 `blind_signed`**: Signed with blind signing (clear signing not available)
- **❌ `error`**: Operation failed (device communication failure, parsing error, timeout, etc.)
