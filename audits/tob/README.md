The following contains the properties written by Trail of Bits.

- [End to End testing with Echidna](#end-to-end-testing-with-echidna)
- [Verification with Manticore](#verification-with-manticore)

# End to End testing with Echidna

We've implemented end-to-end properties for the Uniswap V3 Core pool contract.

## Installation

In order to run this, you need to install [echidna 1.7.0](https://github.com/crytic/echidna/releases/tag/v1.7.0).

## Run

Assuming you're in the root of the repo

```
echidna-test contracts/crytic/echidna/E2E_swap.sol --config contracts/crytic/echidna/E2E_swap.config.yaml --contract E2E_swap

echidna-test contracts/crytic/echidna/E2E_mint_burn.sol --config contracts/crytic/echidna/E2E_mint_burn.config.yaml --contract E2E_mint_burn

echidna-test contracts/crytic/echidna/Other.sol --config contracts/crytic/echidna/Other.config.yaml --contract Other
```

## Random but valid pool initialisation, created positions, and priceLimits

To help Echidna to get good coverage we've used multiple helper functions to:

- create random but valid pool initialization params (fee, tickSpacing, initial price) before doing swaps or mint/burn [link](./E2E_mint_burn.sol#L303-L337) [link](./E2E_swap.sol#L196-L230)
- create a random number of random but valid positions before testing swaps [link](./E2E_swap.sol#L233-L283)
- create a random but valid priceLimit when doing swap [link](./E2E_swap.sol#L68-L80)
- create random but valid position params when doing mint [link](./E2E_mint_burn.sol#L102-L130)

By doing the above Echidna will be able to test the actual properties we want to test instead of bashing it's head against using an invalid priceLimit or invalid position params. The above also allows the creation of a dynamic number of random positions before executing swaps instead of using a static list.

To achieve the above random but valid outcomes we use the `uint128 _amount` of swap/mint/burn as a seed to create randomness in the helper functions. This also means that retrieving the exact used params is not very straightforward. However, through a combination of hardhat `console.sol` and writing a small js unit test it's possible to retrieve the exact used params of every (list of) call(s).

## Adjust hardhat.config.ts

The Echidna contracts cost too much gas to deploy due to all the calls inside the constructor.

Adjust the `hardhat.config.ts` to:

```json
hardhat: {
    allowUnlimitedContractSize: true,
    gas: 950000000,
    blockGasLimit: 950000000,
    gasPrice: 1,
},
```

### E2E_swap: retrieving the pool initialisation params and created positions

The pool initialisation and created positions is deterministic and there is a `view` function that will return whatever a specific `_amount` (used as `_seed`) will create.

Write a js unit test:

```js
console.log(await E2E_swap.viewRandomInit('<the _amount of the first swap call>'))
```

### E2E_swap: retrieving the used priceLimit of a swap

The priceLimit depends on the state of the pool contract, it is therefore easiest to retrieve by using hardhat's `console.sol`.

Uncomment the following lines:

- at the top of `E2E_swap.sol`: `// import 'hardhat/console.sol';`
- inside the swap functions: `// console.log('sqrtPriceLimitX96 = %s', sqrtPriceLimitX96); `

Instead of just one swap call, imagine Echidna reports two swap calls, and the second one causes an assertion failure.

```js
// to get pool params + created positions
console.log(await E2E_swap.viewRandomInit('<the _amount of the first swap call>'))

// execute the swap, which will create the above and log the used priceLimit to the console
await E2E_swap.test_swap_exactOut_oneForZero('<the _amount of the first swap call>')

// execute the swap, logs the used priceLimit to the console
await E2E_swap.test_swap_exactIn_oneForZero('<the _amount of the second swap call>')
```

### E2E_mint_burn: retrieving the pool initialisation params

The pool initialisation params creation is deterministic and there is a `view` function that will return whatever a specific `_amount` (used as `_seed`) will create.

Write a js unit test:

```js
console.log(await E2E_mint_burn.viewInitRandomPoolParams('<the _amount of the first mint call>'))
```

### E2E_mint_burn: retrieving a mint's created random position

```js
const poolInitParams = await E2E_mint_burn.viewInitRandomPoolParams('<the _amount of the first mint call>')

const positionParams = await E2E_mint_burn.viewMintRandomNewPosition(
  '<the _amount of the first mint call>',
  poolInitParams.tickSpacing,
  poolInitParams.tickCount,
  poolInitParams.maxTick
)

console.log(positionParams)
```

### E2E_mint_burn: retrieving a burn's used position

Uncomment the following lines:

- at the top of `E2E_mint_burn.sol`: `// import 'hardhat/console.sol';`
- inside the particular burn function: `// console.log('burn posIdx = %s', posIdx);`
- if this is a partial burn, also want to see the burned amount. inside the `test_burn_partial` function: `// console.log('burn amount = %s', burnAmount);`

Then execute the burn in a js test.

```js
// show pool init params
const poolInitParams = await E2E_mint_burn.viewInitRandomPoolParams('<the _amount of the first mint call>')
console.log(positionParams)

// show pool mint position params
const positionParams = await E2E_mint_burn.viewMintRandomNewPosition(
  '<the _amount of the first mint call>',
  poolInitParams.tickSpacing,
  poolInitParams.tickCount,
  poolInitParams.maxTick
)
console.log(positionParams)

// execute the first mint
await E2E_mint_burn.test_mint('<the _amount of the first mint call>')

// execute the burn
await E2E_mint_burn.test_burn_partial('<the _amount of the first test_burn_partial call>')
// this should log the index of the position that was burned to the console
// as well as the amount that was burned.
// together with the above output this should make it clear which exact position
// was burned and how much
```

# Verification with Manticore

The verification was performed with the experimental branch [dev-evm-experiments](https://github.com/trailofbits/manticore/tree/dev-evm-experiments), which contains new optimizations and is a work in progress. Trail of Bits will ensure that the following properties hold once the branch has stabilized and been included in a Manticore release.

For convenience, we followed the pattern "if there is reachable path, there is a bug".

To verify a property, run:

```
manticore . --contract CONTRACT_NAME --txlimit 1 --smt.solver all --quick-mode --lazy-evaluation --core.procs 1
```

> The command might change once `dev-evm-experiments` has stabilized

Manticore will create a `mcore_X` directory. If no `X.tx` file is generated, it means that Manticore did not find a path violating the property.

| ID  | Description                                                                                          | Contract                                                              | Status   |
| --- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------- |
| 01  | `BitMath.mostSignificantBit returns a value in x >= 2**msb && (msb == 255 or x < 2**(msb+1)).`       | [`VerifyBitMathMsb`](./contracts/crytic/manticore/001.sol)            | Verified |
| 02  | `BitMath.leastSignificantBit returns a value in ((x & 2** lsb) != 0) && ((x & (2**(lsb -1))) == 0).` | [`VerifyBitMathLsb`](./contracts/crytic/manticore/002.sol)            | Verified |
| 03  | `If LiquidityMath.addDelta returns, the value will be equal to x + uint128(y).`                      | [`VerifyLiquidityMathAddDelta`](./contracts/crytic/manticore/003.sol) | Verified |
