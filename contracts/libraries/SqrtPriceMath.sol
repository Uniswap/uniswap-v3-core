// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.5.0;

import '@uniswap/lib/contracts/libraries/FullMath.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/math/SignedSafeMath.sol';

import './FixedPoint128.sol';
import './SafeCast.sol';

library SqrtPriceMath {
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    uint256 public constant Q64 = 0x10000000000000000;

    function getPriceAfterSwap(
        uint128 sqrtP,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) internal pure returns (uint128 sqrtQ) {
        require(sqrtP > 0, 'SqrtPriceMath::getPriceAfterSwap: sqrtP cannot be zero');
        require(liquidity > 0, 'SqrtPriceMath::getPriceAfterSwap: liquidity cannot be zero');
        if (amountIn == 0) return sqrtP;

        if (zeroForOne) {
            uint256 divisibleLiquidity = uint256(liquidity) << 64;
            // todo: precision loss in division
            sqrtQ = (divisibleLiquidity / (divisibleLiquidity / sqrtP).add(amountIn)).toUint128();
        } else {
            sqrtQ = uint256(sqrtP).add(FullMath.mulDiv(amountIn, Q64, liquidity)).toUint128();
        }
    }

    function getAmountDeltas(
        uint128 sqrtP,
        uint128 sqrtQ,
        uint128 liquidity
    ) internal pure returns (int256 amount0, int256 amount1) {
        require(sqrtP != 0 && sqrtQ != 0, 'SqrtPriceMath::getAmountDeltas: price cannot be 0');
        if (sqrtP == sqrtQ || liquidity == 0) return (0, 0);

        uint256 denom = uint256(sqrtP).mul(sqrtQ);
        uint256 amount0Abs = FullMath.mulDiv(
            liquidity,
            uint256(sqrtP < sqrtQ ? sqrtQ - sqrtP : sqrtP - sqrtQ) << 64,
            denom
        );
        amount0 = sqrtP < sqrtQ ? -amount0Abs.toInt256() : amount0Abs.toInt256();

        amount1 = int256(liquidity).mul(int256(sqrtQ) - int256(sqrtP)).div(int256(Q64));
    }
}
