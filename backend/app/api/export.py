from fastapi import APIRouter

router = APIRouter()


@router.post("/pdf/{script_id}")
async def export_pdf(script_id: str):
    return {"message": "PDF export - TODO"}


@router.post("/fdx/{script_id}")
async def export_fdx(script_id: str):
    return {"message": "FDX export - TODO"}


@router.post("/fountain/{script_id}")
async def export_fountain(script_id: str):
    return {"message": "Fountain export - TODO"}
