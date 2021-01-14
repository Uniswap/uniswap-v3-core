import bn from 'bignumber.js'
import { BigNumber, BigNumberish, constants, Contract, ContractTransaction, utils, Wallet } from 'ethers'
import { TestUniswapV3Callee } from '../../typechain/TestUniswapV3Callee'
import { TestUniswapV3Router } from '../../typechain/TestUniswapV3Router'
import { UniswapV3Pair } from '../../typechain/UniswapV3Pair'
import { MockTimeUniswapV3Pair } from '../../typechain/MockTimeUniswapV3Pair'
import { TestERC20 } from '../../typechain/TestERC20'

export const getMinTick = (tickSpacing: number) => Math.ceil(-887272 / tickSpacing) * tickSpacing
export const getMaxTick = (tickSpacing: number) => Math.floor(887272 / tickSpacing) * tickSpacing
export const getMaxLiquidityPerTick = (tickSpacing: number) =>
  BigNumber.from(2)
    .pow(128)
    .sub(1)
    .div((getMaxTick(tickSpacing) - getMinTick(tickSpacing)) / tickSpacing + 1)

export const NUMBER_OF_ORACLE_OBSERVATIONS = 1024

export enum FeeAmount {
  LOW = 600,
  MEDIUM = 3000,
  HIGH = 9000,
}

export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
  [FeeAmount.LOW]: 12,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 180,
}

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  fee: number,
  bytecode: string
): string {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]
  const constructorArgumentsEncoded = utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint24'],
    [token0, token1, fee]
  )
  const create2Inputs = [
    '0xff',
    factoryAddress,
    // salt
    utils.keccak256(constructorArgumentsEncoded),
    // init code. bytecode + constructor arguments
    utils.keccak256(bytecode),
  ]
  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join('')}`
  return utils.getAddress(`0x${utils.keccak256(sanitizedInputs).slice(-40)}`)
}

bn.config({ EXPONENTIAL_AT: 999999 })

// returns the sqrt price as a 64x96
export function encodePriceSqrt(reserve1: BigNumberish, reserve0: BigNumberish): BigNumber {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  )
}

export function getPositionKey(address: string, lowerTick: number, upperTick: number): string {
  return utils.keccak256(utils.solidityPack(['address', 'int24', 'int24'], [address, lowerTick, upperTick]))
}

export type SwapFunction = (amount: BigNumberish, to: Wallet | string) => Promise<ContractTransaction>
export type MintFunction = (
  recipient: string,
  tickLower: BigNumberish,
  tickUpper: BigNumberish,
  liquidity: BigNumberish,
  data?: string
) => Promise<ContractTransaction>
export interface PairFunctions {
  swapToLowerPrice: SwapFunction
  swapToHigherPrice: SwapFunction
  swapExact0For1: SwapFunction
  swap0ForExact1: SwapFunction
  swapExact1For0: SwapFunction
  swap1ForExact0: SwapFunction
  mint: MintFunction
}
export function createPairFunctions({
  token0,
  token1,
  swapTarget,
  pair,
}: {
  swapTarget: TestUniswapV3Callee
  token0: TestERC20
  token1: TestERC20
  pair: MockTimeUniswapV3Pair
}): PairFunctions {
  async function swapToSqrtPrice(
    inputToken: Contract,
    targetPrice: BigNumberish,
    to: Wallet | string
  ): Promise<ContractTransaction> {
    const method = inputToken === token0 ? swapTarget.swapToLowerSqrtPrice : swapTarget.swapToHigherSqrtPrice

    await inputToken.approve(swapTarget.address, constants.MaxUint256)

    const toAddress = typeof to === 'string' ? to : to.address

    return method(pair.address, targetPrice, toAddress)
  }

  async function swap(
    inputToken: Contract,
    [amountIn, amountOut]: [BigNumberish, BigNumberish],
    to: Wallet | string
  ): Promise<ContractTransaction> {
    const exactInput = amountOut === 0

    const method =
      inputToken === token0
        ? exactInput
          ? swapTarget.swapExact0For1
          : swapTarget.swap0ForExact1
        : exactInput
        ? swapTarget.swapExact1For0
        : swapTarget.swap1ForExact0

    await inputToken.approve(swapTarget.address, exactInput ? amountIn : constants.MaxUint256)

    const toAddress = typeof to === 'string' ? to : to.address

    return method(pair.address, exactInput ? amountIn : amountOut, toAddress)
  }

  const swapToLowerPrice: SwapFunction = (sqrtPriceX96, to) => {
    return swapToSqrtPrice(token0, sqrtPriceX96, to)
  }

  const swapToHigherPrice: SwapFunction = (sqrtPriceX96, to) => {
    return swapToSqrtPrice(token1, sqrtPriceX96, to)
  }

  const swapExact0For1: SwapFunction = (amount, to) => {
    return swap(token0, [amount, 0], to)
  }

  const swap0ForExact1: SwapFunction = (amount, to) => {
    return swap(token0, [0, amount], to)
  }

  const swapExact1For0: SwapFunction = (amount, to) => {
    return swap(token1, [amount, 0], to)
  }

  const swap1ForExact0: SwapFunction = (amount, to) => {
    return swap(token1, [0, amount], to)
  }

  const mint: MintFunction = async (recipient, tickLower, tickUpper, liquidity) => {
    await token0.approve(swapTarget.address, constants.MaxUint256)
    await token1.approve(swapTarget.address, constants.MaxUint256)
    return swapTarget.mint(pair.address, recipient, tickLower, tickUpper, liquidity)
  }

  return {
    swapToLowerPrice,
    swapToHigherPrice,
    swapExact0For1,
    swap0ForExact1,
    swapExact1For0,
    swap1ForExact0,
    mint,
  }
}

export interface MultiPairFunctions {
  swap0ForExact2: any
  swap2ForExact0: any
}

export function createMultiPairFunctions({
  inputToken,
  swapTarget,
  pair0,
  pair1,
}: {
  inputToken: TestERC20
  swapTarget: TestUniswapV3Router
  pair0: UniswapV3Pair
  pair1: UniswapV3Pair
}): MultiPairFunctions {
  async function swap0ForExact2(amountOut: BigNumberish, to: Wallet | string): Promise<ContractTransaction> {
    const method = swapTarget.swap0ForExact2
    await inputToken.approve(swapTarget.address, constants.MaxUint256)
    const toAddress = typeof to === 'string' ? to : to.address
    return method([pair0.address, pair1.address], amountOut, toAddress, false)
  }

  async function swap2ForExact0(amountOut: BigNumberish, to: Wallet | string): Promise<ContractTransaction> {
    const method = swapTarget.swap2ForExact0
    await inputToken.approve(swapTarget.address, constants.MaxUint256)
    const toAddress = typeof to === 'string' ? to : to.address
    return method([pair0.address, pair1.address], amountOut, toAddress, false)
  }

  return {
    swap0ForExact2,
    swap2ForExact0,
  }
}
