import {BigNumber, BigNumberish, utils, constants, Contract, Wallet, ContractTransaction, Signer} from 'ethers'
import bn from 'bignumber.js'
import {TestERC20} from '../../typechain/TestERC20'
import {UniswapV3Pair} from '../../typechain/UniswapV3Pair'
import {PayAndForwardContract} from '../../typechain/PayAndForwardContract'
export const MIN_TICK = -7351
export const MAX_TICK = 7351
export const MAX_LIQUIDITY_GROSS_PER_TICK = BigNumber.from('20282409603651670423947251286015')

export enum FeeAmount {
  LOW = 600,
  MEDIUM = 3000,
  HIGH = 9000,
}

export const TICK_SPACINGS: {[amount in FeeAmount]: number} = {
  [FeeAmount.LOW]: 1,
  [FeeAmount.MEDIUM]: 1,
  [FeeAmount.HIGH]: 1,
}

export function expandTo18Decimals(n: number): BigNumber {
  return BigNumber.from(n).mul(BigNumber.from(10).pow(18))
}

export function getCreate2Address(
  factoryAddress: string,
  [tokenA, tokenB]: [string, string],
  fee: number,
  tickSpacing: number,
  bytecode: string
): string {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]
  const constructorArgumentsEncoded = utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint24', 'int24'],
    [factoryAddress, token0, token1, fee, tickSpacing]
  )
  const create2Inputs = [
    '0xff',
    factoryAddress,
    // salt
    constants.HashZero,
    // init code. bytecode + constructor arguments
    utils.keccak256(bytecode + constructorArgumentsEncoded.substr(2)),
  ]
  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join('')}`
  return utils.getAddress(`0x${utils.keccak256(sanitizedInputs).slice(-40)}`)
}

export function encodePrice(reserve1: BigNumberish, reserve0: BigNumberish): BigNumber {
  return BigNumber.from(reserve1).mul(BigNumber.from(2).pow(128)).div(reserve0)
}

export function encodePriceSqrt(reserve1: BigNumberish, reserve0: BigNumberish): BigNumber {
  return BigNumber.from(new bn(encodePrice(reserve1, reserve0).toString()).sqrt().integerValue(3).toString())
}

export function getPositionKey(address: string, lowerTick: number, upperTick: number): string {
  return utils.keccak256(utils.solidityPack(['address', 'int24', 'int24'], [address, lowerTick, upperTick]))
}

// handles if the result is an array (in the case of fixed point struct return values where it's an array of one uint224)
export function bnify2(a: BigNumberish | [BigNumberish] | {0: BigNumberish}): BigNumber {
  if (Array.isArray(a)) {
    return BigNumber.from(a[0])
  } else {
    return BigNumber.from(a)
  }
}

export type SwapFunction = (
  amount: BigNumberish,
  to: Wallet | string
) => Promise<{amountOut: BigNumber; tx: ContractTransaction}>
export interface SwapFunctions {
  swap0For1: SwapFunction
  swap1For0: SwapFunction
}
export function createSwapFunctions({
  token0,
  token1,
  swapTarget,
  pair,
  from,
}: {
  from: Signer
  swapTarget: PayAndForwardContract
  token0: TestERC20
  token1: TestERC20
  pair: UniswapV3Pair
}): SwapFunctions {
  /**
   * Execute a swap against the pair of the input token in the input amount, sending proceeds to the given to address
   */
  async function _swap(
    inputToken: Contract,
    amountIn: BigNumberish,
    to: Wallet | string
  ): Promise<{amountOut: BigNumber; tx: ContractTransaction}> {
    const method = inputToken === token0 ? 'swap0For1' : 'swap1For0'

    await inputToken.connect(from).transfer(swapTarget.address, amountIn)

    const data = utils.defaultAbiCoder.encode(
      ['uint256', 'address'],
      [amountIn, typeof to === 'string' ? to : to.address]
    )
    const amountOut = await pair.connect(from).callStatic[method](amountIn, swapTarget.address, data)
    const tx = await pair.connect(from)[method](amountIn, swapTarget.address, data)
    return {tx, amountOut}
  }

  const swap0For1: SwapFunction = (amount, to) => {
    return _swap(token0, amount, to)
  }

  const swap1For0: SwapFunction = (amount, to) => {
    return _swap(token1, amount, to)
  }

  return {swap0For1, swap1For0}
}
