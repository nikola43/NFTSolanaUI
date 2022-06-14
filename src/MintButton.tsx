import styled from 'styled-components';
import { useEffect, useState } from 'react';
import Button from '@material-ui/core/Button';
import { CircularProgress } from '@material-ui/core';
import { GatewayStatus, useGateway } from '@civic/solana-gateway-react';
import { CandyMachineAccount } from './candy-machine';


export const CTAButton = styled(Button)`
  display: block !important;
  margin: 0 auto !important;
  background-color: var(--title-text-color) !important;
  min-width: 120px !important;
  font-size: 1em !important;
`;

export const MintButton = ({
    onMint,
    candyMachine,
    isMinting,
    isEnded,
    isActive,
}: {
    onMint: () => Promise<void>;
    candyMachine?: CandyMachineAccount;
    isMinting: boolean;
    isEnded: boolean;
    isActive: boolean;
}) => {
    const { requestGatewayToken, gatewayStatus } = useGateway();
    const [clicked, setClicked] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);

    useEffect(() => {
        setIsVerifying(false);
        if (gatewayStatus === GatewayStatus.COLLECTING_USER_INFORMATION && clicked) {
            // when user approves wallet verification txn
            setIsVerifying(true);
        } else if (gatewayStatus === GatewayStatus.ACTIVE && clicked) {
            console.log('Verified human, now minting...');
            onMint();
            setClicked(false);
        }
    }, [gatewayStatus, clicked, setClicked, onMint]);

    return (
        <CTAButton
            disabled={
                clicked
            }
            onClick={async () => {

                console.log('Minting...');
                await onMint();

            }}
            variant="contained"
        >
            {!candyMachine ? (
                "CONNECTING..."
            ) : candyMachine ? (
                'SOLD OUT'
            ) : isActive ? (
                isVerifying ? 'VERIFYING...' :
                    isMinting || clicked ? (
                        <CircularProgress />
                    ) : (
                        "MINT"
                    )
            ) : isEnded ? "ENDED" : (candyMachine ? (
                "SOON"
            ) : (
                "UNAVAILABLE"
            ))}
        </CTAButton>
    );
};
