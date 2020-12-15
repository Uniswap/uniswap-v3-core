// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.5.0;

import '@uniswap/lib/contracts/libraries/FullMath.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/math/Math.sol';

import './SafeCast.sol';
import './FixedPoint96.sol';
import './FixedPoint128.sol';

library SqrtPriceMath {
    using SafeMath for uint256;
    using SafeCast for uint256;

    function divRoundingUp(uint256 x, uint256 d) private pure returns (uint256) {
        // addition is safe because (uint256(-1) / 1) + (uint256(-1) % 1 > 0 ? 1 : 0) == uint256(-1)
        return (x / d) + (x % d > 0 ? 1 : 0);
    }

    function isMulSafe(uint256 x, uint256 y) private pure returns (bool) {
        return (x * y) / x == y;
    }

    function isAddSafe(uint256 x, uint256 y) private pure returns (bool) {
        return x <= uint256(-1) - y;
    }

    function isSubSafe(uint256 x, uint256 y) private pure returns (bool) {
        return x >= y;
    }

    function mulDivRoundingUp(
        uint256 x,
        uint256 y,
        uint256 d
    ) internal pure returns (uint256) {
        return FullMath.mulDiv(x, y, d) + (mulmod(x, y, d) > 0 ? 1 : 0);
    }

    function getNextPriceRoundingUp(
        FixedPoint96.uq64x96 memory sqrtP,
        uint128 liquidity,
        uint256 amount,
        bool add
    ) internal pure returns (FixedPoint96.uq64x96 memory) {
        // calculate liquidity * sqrt(P) / (liquidity +- x * sqrt(P))
        // or, if this is impossible because of overlow,
        // calculate liquidity / (liquidity / sqrt(P) +- x)

        uint256 numerator1 = uint256(liquidity) << FixedPoint96.RESOLUTION;

        if (
            isMulSafe(amount, sqrtP._x) &&
            (add ? isAddSafe(numerator1, amount * sqrtP._x) : isSubSafe(numerator1, amount * sqrtP._x))
        ) {
            uint256 denominator = add ? (numerator1 + amount * sqrtP._x) : (numerator1 - amount * sqrtP._x);
            return FixedPoint96.uq64x96(mulDivRoundingUp(numerator1, sqrtP._x, denominator).toUint160());
        } else {
            return FixedPoint96.uq64x96(add
                ? divRoundingUp(numerator1, (numerator1 / sqrtP._x).add(amount)).toUint160()
                : divRoundingUp(numerator1, (numerator1 / sqrtP._x).sub(amount)).toUint160()
            );
        }
    }

    function getNextPriceRoundingDown(
        FixedPoint96.uq64x96 memory sqrtP,
        uint128 liquidity,
        uint256 amount,
        bool add
    ) internal pure returns (FixedPoint96.uq64x96 memory) {
        // calculate sqrt(P) +- y / liquidity

        uint256 quotient;
        if (add) {
            // avoid a mulDiv for most inputs
            quotient = amount <= uint160(-1)
                ? (amount << FixedPoint96.RESOLUTION) / liquidity
                : FullMath.mulDiv(amount, FixedPoint96.Q96, liquidity);            
        } else {
            // avoid a mulDiv for most inputs
            quotient = amount <= uint160(-1)
                ? divRoundingUp(amount << FixedPoint96.RESOLUTION, liquidity)
                : mulDivRoundingUp(amount, FixedPoint96.Q96, liquidity);
        }
        return FixedPoint96.uq64x96((add
            ? uint256(sqrtP._x).add(quotient)
            : uint256(sqrtP._x).sub(quotient)
        ).toUint160());
    }

    function getNextPriceFromInput(
        FixedPoint96.uq64x96 memory sqrtP,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) internal pure returns (FixedPoint96.uq64x96 memory sqrtQ) {
        assert(sqrtP._x != 0);
        assert(liquidity != 0);
        if (amountIn == 0) return sqrtP;

        // round to make sure that we don't pass the target price
        return zeroForOne
            ? getNextPriceRoundingUp(sqrtP, liquidity, amountIn, true)
            : getNextPriceRoundingDown(sqrtP, liquidity, amountIn, true);
    }

    function getNextPriceFromOutput(
        FixedPoint96.uq64x96 memory sqrtP,
        uint128 liquidity,
        uint256 amountOut,
        bool zeroForOne
    ) internal pure returns (FixedPoint96.uq64x96 memory sqrtQ) {
        assert(sqrtP._x != 0);
        assert(liquidity != 0);
        if (amountOut == 0) return sqrtP;

        // round to make sure that we pass the target price
        return zeroForOne
            ? getNextPriceRoundingDown(sqrtP, liquidity, amountOut, false)
            : getNextPriceRoundingUp(sqrtP, liquidity, amountOut, false);
    }

    function getAmount0Delta(
        FixedPoint96.uq64x96 memory sqrtP, // square root of current price
        FixedPoint96.uq64x96 memory sqrtQ, // square root of target price
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount0) {
        assert(sqrtP._x >= sqrtQ._x);

        uint256 numerator1 = uint256(liquidity) << FixedPoint96.RESOLUTION;
        uint256 numerator2 = sqrtP._x - sqrtQ._x;

        // calculate liquidity / sqrt(Q) - liquidity / sqrt(P), i.e.
        // calculate liquidity * (sqrt(P) - sqrt(Q)) / (sqrt(P) * sqrt(Q))
        if (isMulSafe(sqrtP._x, sqrtQ._x)) {
            uint256 denominator = uint256(sqrtP._x) * sqrtQ._x;
            if (roundUp) return mulDivRoundingUp(numerator1, numerator2, denominator);
            else return FullMath.mulDiv(numerator1, numerator2, denominator);
        } else {
            if (roundUp) return divRoundingUp(mulDivRoundingUp(numerator1, numerator2, sqrtP._x), sqrtQ._x);
            else return FullMath.mulDiv(numerator1, numerator2, sqrtP._x) / sqrtQ._x;
        }
    }

    function getAmount1Delta(
        FixedPoint96.uq64x96 memory sqrtP, // square root of current price
        FixedPoint96.uq64x96 memory sqrtQ, // square root of target price
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount1) {
        assert(sqrtQ._x >= sqrtP._x);

        // calculate liquidity * (sqrt(Q) - sqrt(P))
        if (roundUp) return mulDivRoundingUp(liquidity, sqrtQ._x - sqrtP._x, FixedPoint96.Q96);
        else return FullMath.mulDiv(liquidity, sqrtQ._x - sqrtP._x, FixedPoint96.Q96);
    }

    // helpers to get signed deltas for use in setPosition
    // TODO not clear this is the right thing to do
    function getAmount0Delta(
        FixedPoint96.uq64x96 memory sqrtP, // square root of current price
        FixedPoint96.uq64x96 memory sqrtQ, // square root of target price
        int128 liquidity
    ) internal pure returns (int256 amount0) {
        if (liquidity < 0) return -getAmount0Delta(sqrtP, sqrtQ, uint128(-liquidity), false).toInt256();
        else return getAmount0Delta(sqrtP, sqrtQ, uint128(liquidity), true).toInt256();
    }

    function getAmount1Delta(
        FixedPoint96.uq64x96 memory sqrtP, // square root of current price
        FixedPoint96.uq64x96 memory sqrtQ, // square root of target price
        int128 liquidity
    ) internal pure returns (int256 amount0) {
        if (liquidity < 0) return -getAmount1Delta(sqrtP, sqrtQ, uint128(-liquidity), false).toInt256();
        else return getAmount1Delta(sqrtP, sqrtQ, uint128(liquidity), true).toInt256();
    }
}
