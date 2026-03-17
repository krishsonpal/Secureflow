from fastapi import FastAPI
from pydantic import BaseModel
import joblib
import numpy as np
import json
from sklearn.metrics.pairwise import cosine_similarity

app = FastAPI(
    title="SecureFlow XSS Detection Service",
    description="Nearest Centroid + Random Forest based XSS detection microservice",
    version="1.0"
)

# -----------------------------
# LOAD MODELS
# -----------------------------
vectorizer = joblib.load("models/vectorizer.pkl")
rf = joblib.load("models/rf.pkl")

centroid_attack = np.array(joblib.load("models/centroid_attack.pkl"))
centroid_normal = np.array(joblib.load("models/centroid_normal.pkl"))

THRESHOLD = 0.15

# -----------------------------
# REQUEST MODEL
# -----------------------------
class RequestData(BaseModel):
    content: str


# -----------------------------
# DETECTION FUNCTION
# -----------------------------
def detect_xss(text):

    x = vectorizer.transform([text])

    sim_attack = cosine_similarity(x, centroid_attack)[0][0]
    sim_normal = cosine_similarity(x, centroid_normal)[0][0]

    if sim_normal - sim_attack > THRESHOLD:
        return 0, "centroid"

    elif sim_attack - sim_normal > THRESHOLD:
        return 1, "centroid"

    else:
        pred = rf.predict(x)[0]
        return int(pred), "random_forest"


# -----------------------------
# PREDICT
# -----------------------------
@app.post("/predict")
def predict(data: RequestData):

    text = (data.content)
    print(text)
    
    # Try parsing JSON
    try:
        parsed = json.loads(text)
        print(parsed)
        # Scan each field separately
        for key, value in parsed.items():
            print(key,value)
            if isinstance(value, str):
                print(value)
                pred, stage = detect_xss( value )

                if pred == 1:
                    return {
                        "prediction": 1,
                        "field": key,
                        "payload": value,
                        "stage": stage
                    }

        return {
            "prediction": 0,
            "message": "Request safe"
        }

    except:
        # If not JSON → scan whole text
        pred, stage = detect_xss(text)

        return {
            "prediction": pred,
            "stage": stage
        }