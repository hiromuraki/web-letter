from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from .letter import Letter
import asyncio
import os


class UnlockRequest(BaseModel):
    password: str


app = FastAPI()

app.mount("/static", StaticFiles(directory="src/static"), name="static")


@app.post("/api/letter", response_model=Letter)
async def get_letter(request: UnlockRequest):
    await asyncio.sleep(0.2)

    if request.password.strip() != os.getenv("LETTER_PASSWORD", "web-letter"):
        raise HTTPException(status_code=400, detail="通关密语不对哦，再想想~")

    try:
        letter_file_path = os.getenv("LETTER_FILE")
        if not letter_file_path:
            raise HTTPException(status_code=400, detail="没有信件")
        letter = Letter.load(letter_file_path)
        return letter
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="服务器里找不到信件文件啦！")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"信件解析出错: {str(e)}")


@app.get("/")
async def serve_frontend():
    return FileResponse("./src/static/index.html")
