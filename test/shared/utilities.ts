import bn from 'bignumber.js'
import {BigNumber, BigNumberish, constants, Contract, ContractTransaction, Signer, utils, Wallet} from 'ethers'
import {TestERC20} from '../../typechain/TestERC20'
import {TestUniswapV3Callee} from '../../typechain/TestUniswapV3Callee'
import {UniswapV3Pair} from '../../typechain/UniswapV3Pair'

export const getMinTick = (tickSpacing: number) => Math.ceil(-887272 / tickSpacing) * tickSpacing
export const getMaxTick = (tickSpacing: number) => Math.floor(887272 / tickSpacing) * tickSpacing
export const MAX_LIQUIDITY_GROSS_PER_TICK = BigNumber.from('20282409603651670423947251286015')

export enum FeeAmount {
  LOW = 600,
  MEDIUM = 3000,
  HIGH = 9000,
}

export const TICK_SPACINGS: {[amount in FeeAmount]: number} = {
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

bn.config({EXPONENTIAL_AT: 999999})

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
  swapTarget: TestUniswapV3Callee
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
  ): Promise<ContractTransaction> {
    const method = inputToken === token0 ? 'swap0For1' : 'swap1For0'

    await inputToken.connect(from).transfer(swapTarget.address, amountIn)

    const toAddress = typeof to === 'string' ? to : to.address

    const data = '0x' // utils.defaultAbiCoder.encode(['uint256', 'address'], [amountIn, toAddress])
    return await pair.connect(from)[method](amountIn, swapTarget.address, toAddress, data)
  }

  const swap0For1: SwapFunction = (amount, to) => {
    return _swap(token0, amount, to)
  }

  const swap1For0: SwapFunction = (amount, to) => {
    return _swap(token1, amount, to)
  }

  return {swap0For1, swap1For0}
}
