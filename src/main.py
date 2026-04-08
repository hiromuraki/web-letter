from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import asyncio
from .letter import Letter


class UnlockRequest(BaseModel):
    password: str


app = FastAPI()


@app.post("/api/letter", response_model=Letter)
async def get_letter(request: UnlockRequest):
    await asyncio.sleep(0.2)

    if request.password.strip() != "aaa":
        raise HTTPException(status_code=400, detail="通关密语不对哦，再想想~")

    try:
        letter = Letter.load("./data/letter.txt")
        return letter
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="服务器里找不到信件文件啦！")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"信件解析出错: {str(e)}")


@app.get("/")
async def serve_frontend():
    return FileResponse("./src/static/index.html")
