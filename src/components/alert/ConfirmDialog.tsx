import React from 'react'
import { Alert, AlertTitle, Backdrop, Button } from "@mui/material"

interface ConfirmDialogProps {
    open: boolean
    title?: string
    message?: string
    onConfirm: () => void
    onCancel: () => void
}

export function ConfirmDialog({
    open,
    title = 'Confirm removal',
    message = 'Are you sure you want to remove this row?',
    onConfirm,
    onCancel
}: ConfirmDialogProps) {
    return (
        <Backdrop
            sx={(theme) => ({ color: '#fff', zIndex: theme.zIndex.drawer + 1 })}
            open={open}
        >
            <Alert severity="warning">
                <AlertTitle>{title}</AlertTitle>
                <span style={{ marginRight: "40px" }}>{message}</span>
                <Button onClick={onConfirm} color="error" size="small">Yes, remove</Button>
                <Button onClick={onCancel} color="primary" size="small">Cancel</Button>
            </Alert>
        </Backdrop>
    )
}
